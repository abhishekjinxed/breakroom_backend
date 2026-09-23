import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import boredRoutes from "./routes/bored.routes";
import chatRoutes from "./routes/chat.routes";
import safetyRoutes from "./routes/safety.routes";
import inboxRoutes from "./routes/inbox.routes";
import stickyNoteRoutes from "./routes/sticky-note.routes";
import deskRoutes from "./routes/desk.routes";
import walletRoutes from "./routes/wallet.routes";
import notificationRoutes from "./routes/notification.routes";
import ticTacToeRoutes from "./routes/tic-tac-toe.routes";
import connectFourRoutes from "./routes/connect-four.routes";

import { verifyToken } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { sendMessage } from "./services/chat.service";
import { safetyErrorMessage } from "./services/content-safety.service";
import { createAppNotification } from "./services/notification.service";
import {
  initializeSocket,
  registerUserSocket,
  removeUserSocket,
  setUserSocketForeground,
} from "./socket";

const app = express();

const allowedOrigins = new Set([
  "https://breakroomfrontend-production.up.railway.app",
  "http://localhost:8081",
  "http://localhost:19006",
  ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const allowOrigin = (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  callback(new Error("Origin is not allowed"));
};
const isAdult = (dateOfBirth: Date | null) => {
  if (!dateOfBirth) return false;
  const today = new Date();
  return dateOfBirth <= new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
};

app.use(cors({ origin: allowOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Bored API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", userRoutes);
app.use("/api/bored", boredRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/safety", safetyRoutes);
app.use("/api/conversations", inboxRoutes);
app.use("/api/stickies", stickyNoteRoutes);
app.use("/api/desk", deskRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/games/tic-tac-toe", ticTacToeRoutes);
app.use("/api/games/connect-four", connectFourRoutes);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: allowOrigin },
});

initializeSocket(io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { deletedAt: true, status: true } });
    if (!user || user.deletedAt || user.status === "DEACTIVATED") return next(new Error("Account is no longer active"));

    socket.data.userId = payload.userId;

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  registerUserSocket(userId, socket.id);
  prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
  console.log(`🔌 User connected: ${userId}`);

  socket.on("app:presence", (data: { foreground?: boolean }) => {
    setUserSocketForeground(userId, socket.id, data?.foreground === true);
  });

  socket.on("chat:join", async (chatId: string) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { termsAcceptedAt: true, dateOfBirth: true, status: true, deletedAt: true } });
      if (!user || user.deletedAt || user.status === "DEACTIVATED") {
        socket.emit("chat:error", { message: "Your account is no longer active." });
        socket.disconnect(true);
        return;
      }
      if (!user.termsAcceptedAt) {
        socket.emit("chat:error", { message: "Accept the Terms of Use before joining a conversation." });
        return;
      }
      if (!isAdult(user.dateOfBirth)) {
        socket.emit("chat:error", { message: "Breakroom chat is available only to members aged 18 and over. Add your date of birth in Account." });
        return;
      }
      const chat = await prisma.chat.findFirst({
        where: {
          id: chatId,
          endedAt: null,
          OR: [
            {
              user1Id: userId,
            },
            {
              user2Id: userId,
            },
          ],
        },
      });

      if (!chat) {
        socket.emit("chat:error", {
          message: "Chat not found",
        });

        return;
      }

      socket.join(`chat:${chatId}`);

      console.log(
        `👤 ${userId} joined chat ${chatId}`
      );

      socket.emit("chat:joined", {
        chatId,
      });
    } catch (error) {
      console.error("Socket join error:", error);

      socket.emit("chat:error", {
        message: "Unable to join chat",
      });
    }
  });

  socket.on(
    "chat:message",
    async ({
      chatId,
      text,
    }: {
      chatId: string;
      text: string;
    }) => {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { termsAcceptedAt: true, dateOfBirth: true, status: true, deletedAt: true } });
        if (!user || user.deletedAt || user.status === "DEACTIVATED") {
          socket.emit("chat:error", { message: "Your account is no longer active." });
          socket.disconnect(true);
          return;
        }
        if (!user.termsAcceptedAt) {
          socket.emit("chat:error", { message: "Accept the Terms of Use before sending messages." });
          return;
        }
        if (!isAdult(user.dateOfBirth)) {
          socket.emit("chat:error", { message: "Breakroom chat is available only to members aged 18 and over. Add your date of birth in Account." });
          return;
        }
        const result = await sendMessage(userId, chatId, typeof text === "string" ? text : "");
        const message = result.message;
        await createAppNotification({ userId: result.recipientId, type: "DIRECT_MESSAGE", title: "New message", detail: "You have a new private message in Breakroom.", link: `/chat/${chatId}` });

        io.to(`chat:${chatId}`).emit(
          "chat:message",
          {
            id: message.id,
            chatId: message.chatId,
            senderId: message.senderId,
            text: message.text,
            createdAt: message.createdAt,
          }
        );
      } catch (error) {
        console.error(
          "Socket message error:",
          error
        );

        socket.emit("chat:error", { message: safetyErrorMessage(error) ?? (error instanceof Error && error.message === "EMPTY_MESSAGE" ? "Message cannot be empty" : error instanceof Error && error.message === "MESSAGE_TOO_LONG" ? "Message cannot exceed 2000 characters" : error instanceof Error && error.message === "CHAT_NOT_FOUND" ? "Chat not found" : "Unable to send message") });
      }
    }
  );

  socket.on("chat:typing", async (chatId: string) => {
    try {
      const chat = await prisma.chat.findFirst({
        where: {
          id: chatId,
          endedAt: null,
          OR: [
            {
              user1Id: userId,
            },
            {
              user2Id: userId,
            },
          ],
        },
      });

      if (!chat) {
        return;
      }

      socket.to(`chat:${chatId}`).emit(
        "chat:typing",
        {
          userId,
        }
      );
    } catch (error) {
      console.error(
        "Typing event error:",
        error
      );
    }
  });

  socket.on("chat:stop-typing", (chatId: string) => {
    socket.to(`chat:${chatId}`).emit("chat:stop-typing", {
      userId,
    });
  });

  socket.on("disconnect", () => {
    removeUserSocket(userId, socket.id);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(
    `🚀 Bored API running on port ${PORT}`
  );

  console.log(
    `🔌 Socket.IO running on port ${PORT}`
  );
});

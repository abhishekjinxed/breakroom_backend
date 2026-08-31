import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import boredRoutes from "./routes/bored.routes";
import chatRoutes from "./routes/chat.routes";
import pulseRoutes from "./routes/pulse.routes";
import safetyRoutes from "./routes/safety.routes";
import workCircleRoutes from "./routes/work-circle.routes";
import cultureRoutes from "./routes/culture.routes";
import inboxRoutes from "./routes/inbox.routes";
import stickyNoteRoutes from "./routes/sticky-note.routes";
import deskRoutes from "./routes/desk.routes";
import walletRoutes from "./routes/wallet.routes";

import { verifyToken } from "./lib/auth";
import { prisma } from "./lib/prisma";
import {
  initializeSocket,
  registerUserSocket,
  removeUserSocket,
} from "./socket";

const app = express();

app.use(cors());
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
app.use("/api/pulses", pulseRoutes);
app.use("/api/safety", safetyRoutes);
app.use("/api/work-circle", workCircleRoutes);
app.use("/api/culture", cultureRoutes);
app.use("/api/conversations", inboxRoutes);
app.use("/api/stickies", stickyNoteRoutes);
app.use("/api/desk", deskRoutes);
app.use("/api/wallet", walletRoutes);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

initializeSocket(io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) return next(new Error("Account is no longer active"));

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

  socket.on("chat:join", async (chatId: string) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { termsAcceptedAt: true } });
      if (!user?.termsAcceptedAt) {
        socket.emit("chat:error", { message: "Accept the Terms of Use before joining a conversation." });
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

      if (chat.isDirect) {
        const friendship = await prisma.workCircleConnection.findFirst({ where: { status: "ACCEPTED", OR: [{ id: chat.connectionId ?? undefined }, { requesterId: chat.user1Id, recipientId: chat.user2Id }, { requesterId: chat.user2Id, recipientId: chat.user1Id }] } });
        if (!friendship) { socket.emit("chat:error", { message: "This connection is no longer active." }); return; }
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
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { termsAcceptedAt: true } });
        if (!user?.termsAcceptedAt) {
          socket.emit("chat:error", { message: "Accept the Terms of Use before sending messages." });
          return;
        }
        const messageText = text?.trim();

        if (!messageText) {
          return;
        }

        if (messageText.length > 2000) {
          socket.emit("chat:error", {
            message: "Message cannot exceed 2000 characters",
          });

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

        if (chat.isDirect) {
          const friendship = await prisma.workCircleConnection.findFirst({ where: { status: "ACCEPTED", OR: [{ id: chat.connectionId ?? undefined }, { requesterId: chat.user1Id, recipientId: chat.user2Id }, { requesterId: chat.user2Id, recipientId: chat.user1Id }] } });
          if (!friendship) { socket.emit("chat:error", { message: "This connection is no longer active." }); return; }
        }


        const message = await prisma.message.create({
          data: {
            chatId,
            senderId: userId,
            text: messageText,
          },
        });
        await prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });

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

        socket.emit("chat:error", {
          message: "Unable to send message",
        });
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

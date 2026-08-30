import { Server } from "socket.io";

let io: Server | null = null;

const userSockets = new Map<string, string>();

export function initializeSocket(server: Server) {
  io = server;
}

export function registerUserSocket(
  userId: string,
  socketId: string
) {
  userSockets.set(userId, socketId);

  console.log(
    `📡 Socket registered: ${userId} → ${socketId}`
  );
}

export function removeUserSocket(
  userId: string,
  socketId: string
) {
  const currentSocket = userSockets.get(userId);

  if (currentSocket === socketId) {
    userSockets.delete(userId);
  }
}

export function notifyMatch(
  userId: string,
  data: {
    chatId: string;
  }
) {
  if (!io) {
    console.error(
      "❌ Socket.IO has not been initialized"
    );

    return;
  }

  const socketId = userSockets.get(userId);

  if (!socketId) {
    console.log(
      `⚠️ No socket connected for user: ${userId}`
    );

    return;
  }

  console.log(
    `🎉 Sending match to ${userId}`
  );

  io.to(socketId).emit("match_found", data);
}

export function notifyChatLeft(
  userId: string,
  data: { chatId: string }
) {
  if (!io) {
    return;
  }

  const socketId = userSockets.get(userId);

  if (socketId) {
    io.to(socketId).emit("chat:partner-left", data);
  }
}

export function notifyPaperPlane(
  userId: string,
  data: { id: string; message: string; sender: { id: string; anonymousUsername: string }; expiresAt: Date }
) {
  if (!io) return;

  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit("paper_plane:received", data);
  }
}

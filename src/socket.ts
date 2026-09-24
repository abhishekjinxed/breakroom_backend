import { Server } from "socket.io";

let io: Server | null = null;

const userSockets = new Map<string, string>();
const foregroundSockets = new Map<string, Set<string>>();

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
  const sockets = foregroundSockets.get(userId);
  sockets?.delete(socketId);
  if (!sockets?.size) foregroundSockets.delete(userId);
}

/** A foreground client receives live in-app updates, so it does not need an OS push. */
export function setUserSocketForeground(userId: string, socketId: string, foreground: boolean) {
  if (!foreground) {
    const sockets = foregroundSockets.get(userId);
    sockets?.delete(socketId);
    if (!sockets?.size) foregroundSockets.delete(userId);
    return;
  }
  const sockets = foregroundSockets.get(userId) ?? new Set<string>();
  sockets.add(socketId);
  foregroundSockets.set(userId, sockets);
}

export function isUserActiveInApp(userId: string) {
  return (foregroundSockets.get(userId)?.size ?? 0) > 0;
}

export function isUserViewingChat(userId: string, chatId: string) {
  if (!io) return false;
  const members = io.sockets.adapter.rooms.get(`chat:${chatId}`);
  if (!members) return false;
  for (const socketId of members) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.data.userId === userId && foregroundSockets.get(userId)?.has(socketId)) return true;
  }
  return false;
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

/** Count distinct currently connected accounts without exposing any identity data. */
export function getOnlineUserCount() {
  return userSockets.size;
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
  data: { id: string; message: string; isCharter: boolean; sender: { id: string; anonymousUsername: string }; expiresAt: Date }
) {
  if (!io) return;

  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit("paper_plane:received", data);
  }
}

export function notifyInboxUpdated(userId: string, data: { chatId: string }) {
  if (!io) return;
  const socketId = userSockets.get(userId);
  if (socketId) io.to(socketId).emit("inbox:updated", data);
}

export function notifyAppNotification(
  userId: string,
  data: { id: string; title: string; detail: string; link: string | null; createdAt: Date }
) {
  if (!io) return;
  const socketId = userSockets.get(userId);
  if (socketId) io.to(socketId).emit("notification:created", data);
}

export function disconnectUserSockets(userId: string, reason = "Your account is no longer active.") {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === userId) {
      socket.emit("account:disabled", { message: reason });
      socket.disconnect(true);
    }
  }
  userSockets.delete(userId);
  foregroundSockets.delete(userId);
}

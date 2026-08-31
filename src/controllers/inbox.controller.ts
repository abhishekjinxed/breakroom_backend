import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { notifyChatLeft } from "../socket";

const member = { id: true, anonymousUsername: true } as const;

async function ensureAcceptedPlaneChats(userId: string) {
  const acceptedPlanes = await prisma.paperPlaneInvite.findMany({
    // Only reconcile recent accepts. Historical accepted planes may belong to
    // conversations deliberately crushed or deleted by a participant.
    where: { status: "ACCEPTED", respondedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, OR: [{ senderId: userId }, { recipientId: userId }] },
    select: { senderId: true, recipientId: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const plane of acceptedPlanes) {
      let connection = await tx.workCircleConnection.findFirst({ where: { OR: [{ requesterId: plane.senderId, recipientId: plane.recipientId }, { requesterId: plane.recipientId, recipientId: plane.senderId }] } });
      // REMOVED means either participant intentionally ended this connection.
      if (connection?.status === "REMOVED") continue;
      if (!connection) {
        connection = await tx.workCircleConnection.create({ data: { requesterId: plane.senderId, recipientId: plane.recipientId, requestType: "PLANE", status: "ACCEPTED", respondedAt: new Date() } });
      } else if (connection.status !== "ACCEPTED") {
        connection = await tx.workCircleConnection.update({ where: { id: connection.id }, data: { requesterId: plane.senderId, recipientId: plane.recipientId, requestType: "PLANE", status: "ACCEPTED", respondedAt: new Date() } });
      }

      const anyDirectChat = await tx.chat.findFirst({ where: { isDirect: true, OR: [{ user1Id: plane.senderId, user2Id: plane.recipientId }, { user1Id: plane.recipientId, user2Id: plane.senderId }] }, orderBy: { createdAt: "desc" } });
      // Never recreate a direct chat that has been explicitly ended.
      if (anyDirectChat?.endedAt) continue;
      const existingChat = anyDirectChat;
      if (!existingChat) {
        await tx.chat.create({ data: { user1Id: plane.senderId, user2Id: plane.recipientId, isDirect: true, connectionId: connection.id, lastMessageAt: new Date() } });
      } else if (existingChat.connectionId !== connection.id) {
        await tx.chat.update({ where: { id: existingChat.id }, data: { connectionId: connection.id, lastMessageAt: existingChat.lastMessageAt ?? new Date() } });
      }
    }
  });
}

export async function listInbox(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  // Reconcile only a fresh acceptance that was interrupted between its Plane
  // response and direct-chat creation.
  await ensureAcceptedPlaneChats(userId);
  const chats = await prisma.chat.findMany({
    where: { isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: { user1: { select: member }, user2: { select: member }, messages: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } } },
  });
  // A chat can retain an old connectionId after a user reconnects through a
  // new Plane. Resolve eligibility from the active user pair, rather than
  // only from the chat's stored relation.
  const activeConnections = await prisma.workCircleConnection.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { recipientId: userId }] }, select: { requesterId: true, recipientId: true } });
  const connectedIds = new Set(activeConnections.map((connection) => connection.requesterId === userId ? connection.recipientId : connection.requesterId));
  const visibleChats = chats.filter((chat) => connectedIds.has(chat.user1Id === userId ? chat.user2Id : chat.user1Id));
  // One person, one active Inbox thread. Older duplicates can exist from
  // earlier app versions; show only the most recently active one.
  const newestByMember = new Map<string, typeof visibleChats[number]>();
  for (const chat of visibleChats) {
    const memberId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
    const current = newestByMember.get(memberId);
    const chatTime = (chat.lastMessageAt ?? chat.createdAt).getTime();
    const currentTime = current ? (current.lastMessageAt ?? current.createdAt).getTime() : -1;
    if (!current || chatTime > currentTime) newestByMember.set(memberId, chat);
  }
  const conversations = Array.from(newestByMember.values()).sort((a, b) => (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime()).map((chat) => ({ id: chat.id, member: chat.user1Id === userId ? chat.user2 : chat.user1, latestMessage: chat.messages[0] ? { text: chat.messages[0].text, createdAt: chat.messages[0].createdAt } : null, unreadCount: chat._count.messages, updatedAt: chat.lastMessageAt ?? chat.createdAt }));
  return res.json({ success: true, conversations });
}

export async function readConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const chat = await prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] } });
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  const activeConnection = await prisma.workCircleConnection.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: userId, recipientId: otherUserId }, { requesterId: otherUserId, recipientId: userId }] } });
  if (!activeConnection) return res.status(404).json({ success: false, message: "Conversation not found." });
  await prisma.message.updateMany({ where: { chatId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
  const messages = await prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "asc" }, select: { id: true, chatId: true, senderId: true, text: true, createdAt: true, readAt: true } });
  return res.json({ success: true, messages });
}

export async function deleteConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const result = await prisma.$transaction(async (tx) => {
    // Do not require a live relation here. A previous partial deletion or an
    // older chat can legitimately have no connectionId, but its owner must
    // still be able to remove it from their Inbox.
    const chat = await tx.chat.findFirst({ where: { id: chatId, isDirect: true, OR: [{ user1Id: userId }, { user2Id: userId }] } });
    if (!chat) return { removed: false, otherUserId: null };
    if (chat.endedAt) return { removed: true, otherUserId: chat.user1Id === userId ? chat.user2Id : chat.user1Id };
    const now = new Date();
    const connectionId = chat.connectionId;
    if (connectionId) await tx.workCircleConnection.updateMany({ where: { id: connectionId, status: "ACCEPTED" }, data: { status: "REMOVED", respondedAt: now } });
    // Keep the historical chat ended, but free its unique connectionId so a
    // future mutually accepted Paper Plane can create a fresh conversation.
    await tx.chat.update({ where: { id: chat.id }, data: { endedAt: now, connectionId: null } });
    return { removed: true, otherUserId: chat.user1Id === userId ? chat.user2Id : chat.user1Id };
  });
  if (result.removed && result.otherUserId) notifyChatLeft(result.otherUserId, { chatId });
  return res.json({ success: true, removed: result.removed });
}

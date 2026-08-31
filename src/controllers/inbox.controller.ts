import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const member = { id: true, anonymousUsername: true } as const;

export async function listInbox(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chats = await prisma.chat.findMany({
    where: { isDirect: true, endedAt: null, connection: { status: "ACCEPTED" }, OR: [{ user1Id: userId }, { user2Id: userId }], AND: [{ user1: { blocksCreated: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } } }, { user2: { blocksCreated: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } } }] },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: { user1: { select: member }, user2: { select: member }, messages: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } } },
  });
  return res.json({ success: true, conversations: chats.map((chat) => ({ id: chat.id, member: chat.user1Id === userId ? chat.user2 : chat.user1, latestMessage: chat.messages[0] ? { text: chat.messages[0].text, createdAt: chat.messages[0].createdAt } : null, unreadCount: chat._count.messages, updatedAt: chat.lastMessageAt ?? chat.createdAt })) });
}

export async function readConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const chat = await prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, connection: { status: "ACCEPTED" }, OR: [{ user1Id: userId }, { user2Id: userId }] } });
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  await prisma.message.updateMany({ where: { chatId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
  const messages = await prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "asc" }, select: { id: true, chatId: true, senderId: true, text: true, createdAt: true, readAt: true } });
  return res.json({ success: true, messages });
}

export async function deleteConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const removed = await prisma.$transaction(async (tx) => {
    const chat = await tx.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, connection: { status: "ACCEPTED" }, OR: [{ user1Id: userId }, { user2Id: userId }] } });
    if (!chat) return false;
    await tx.chat.update({ where: { id: chat.id }, data: { endedAt: new Date(), connectionId: null } });
    if (chat.connectionId) await tx.workCircleConnection.updateMany({ where: { id: chat.connectionId, status: "ACCEPTED" }, data: { status: "REMOVED", respondedAt: new Date() } });
    return true;
  });
  return res.json({ success: true, removed });
}

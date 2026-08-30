import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const memberSelect = { id: true, anonymousUsername: true, bio: true, gender: true, dateOfBirth: true } as const;

function publicMember(member: { id: string; anonymousUsername: string; bio: string | null; gender: string | null; dateOfBirth: Date | null }) {
  const today = new Date();
  const birth = member.dateOfBirth;
  const age = !birth ? null : today.getUTCFullYear() - birth.getUTCFullYear() - (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate()) ? 1 : 0);
  const { dateOfBirth, ...safeMember } = member;
  return { ...safeMember, age };
}

async function isBlocked(firstUserId: string, secondUserId: string) {
  return prisma.userBlock.findFirst({ where: { OR: [{ blockerId: firstUserId, blockedId: secondUserId }, { blockerId: secondUserId, blockedId: firstUserId }] }, select: { blockerId: true } });
}

export async function requestConnection(req: AuthenticatedRequest, res: Response) {
  const requesterId = req.userId;
  const recipientId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!requesterId) return res.status(401).json({ success: false, message: "Authentication required" });
  if (!recipientId || requesterId === recipientId) return res.status(400).json({ success: false, message: "Choose another member." });
  if (await isBlocked(requesterId, recipientId)) return res.status(404).json({ success: false, message: "Member not found." });
  const recipient = await prisma.user.findFirst({ where: { id: recipientId, deletedAt: null }, select: { id: true } });
  if (!recipient) return res.status(404).json({ success: false, message: "Member not found." });

  const existing = await prisma.workCircleConnection.findFirst({ where: { OR: [{ requesterId, recipientId }, { requesterId: recipientId, recipientId: requesterId }] } });
  if (existing?.status === "ACCEPTED") return res.json({ success: true, connection: existing, message: "Already in your Work Circle." });
  if (existing?.requesterId === recipientId && existing.status === "PENDING") {
    const connection = await prisma.$transaction(async (tx) => {
      const accepted = await tx.workCircleConnection.update({ where: { id: existing.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      await tx.chat.create({ data: { user1Id: accepted.requesterId, user2Id: accepted.recipientId, isDirect: true, connectionId: accepted.id, lastMessageAt: new Date() } });
      return accepted;
    });
    return res.json({ success: true, connection, message: "You are now connected." });
  }
  if (existing?.status === "PENDING") return res.status(409).json({ success: false, message: "Your request is awaiting a response." });
  const connection = existing
    ? await prisma.workCircleConnection.update({ where: { id: existing.id }, data: { requesterId, recipientId, status: "PENDING", respondedAt: null } })
    : await prisma.workCircleConnection.create({ data: { requesterId, recipientId } });
  return res.status(201).json({ success: true, connection, message: "Work Circle request sent." });
}

// Work Circle requests are intentionally initiated from a real Breakroom chat,
// not from browsing profiles. This keeps connections consensual and limits spam.
export async function requestFromChat(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId;
  const chatId = typeof req.params.chatId === "string" ? req.params.chatId : "";
  if (!userId || !chatId) return res.status(400).json({ success: false, message: "Open a chat before sending a Work Circle request." });
  const chat = await prisma.chat.findFirst({ where: { id: chatId, OR: [{ user1Id: userId }, { user2Id: userId }] }, select: { user1Id: true, user2Id: true } });
  if (!chat) return res.status(404).json({ success: false, message: "Chat not found." });
  (req.params as Record<string, string>).userId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  return requestConnection(req, res);
}

export async function listWorkCircle(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const [incoming, connections] = await Promise.all([
    prisma.workCircleConnection.findMany({ where: { recipientId: userId, status: "PENDING" }, include: { requester: { select: memberSelect } }, orderBy: { createdAt: "desc" } }),
    prisma.workCircleConnection.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { recipientId: userId }] }, include: { requester: { select: memberSelect }, recipient: { select: memberSelect } }, orderBy: { respondedAt: "desc" } }),
  ]);
  return res.json({ success: true, requests: incoming.map((item) => ({ id: item.id, createdAt: item.createdAt, member: publicMember(item.requester) })), connections: connections.map((item) => ({ id: item.id, createdAt: item.respondedAt ?? item.createdAt, member: publicMember(item.requesterId === userId ? item.recipient : item.requester) })) });
}

export async function respondToConnection(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId;
  const accept = req.body?.accept;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  if (typeof accept !== "boolean") return res.status(400).json({ success: false, message: "Choose whether to accept the request." });
  const connectionId = typeof req.params.id === "string" ? req.params.id : "";
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.workCircleConnection.findFirst({ where: { id: connectionId, recipientId: userId } });
    if (!request) return null;
    if (request.status === "ACCEPTED") {
      const chat = await tx.chat.findFirst({ where: { isDirect: true, endedAt: null, OR: [{ connectionId: request.id }, { user1Id: request.requesterId, user2Id: request.recipientId }, { user1Id: request.recipientId, user2Id: request.requesterId }] } });
      return { status: "ACCEPTED", chatId: chat?.id };
    }
    if (request.status !== "PENDING") return null;
    if (!accept) { await tx.workCircleConnection.update({ where: { id: request.id }, data: { status: "DECLINED", respondedAt: new Date() } }); return { status: "DECLINED" }; }
    await tx.workCircleConnection.update({ where: { id: request.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    const chat = await tx.chat.create({ data: { user1Id: request.requesterId, user2Id: request.recipientId, isDirect: true, connectionId: request.id, lastMessageAt: new Date() } });
    return { status: "ACCEPTED", chatId: chat.id };
  });
  if (!result) return res.status(404).json({ success: false, message: "Request not found." });
  return res.json({ success: true, ...result });
}

export async function openDirectChat(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const connectionId = typeof req.params.id === "string" ? req.params.id : "";
  const connection = await prisma.workCircleConnection.findFirst({ where: { id: connectionId, status: "ACCEPTED", OR: [{ requesterId: userId }, { recipientId: userId }] } });
  if (!connection) return res.status(404).json({ success: false, message: "Connection not found." });
  const otherUserId = connection.requesterId === userId ? connection.recipientId : connection.requesterId;
  let chat = await prisma.chat.findFirst({ where: { isDirect: true, endedAt: null, OR: [{ connectionId }, { user1Id: userId, user2Id: otherUserId }, { user1Id: otherUserId, user2Id: userId }] }, orderBy: { createdAt: "desc" } });
  if (chat && !chat.connectionId) chat = await prisma.chat.update({ where: { id: chat.id }, data: { connectionId } });
  if (!chat) chat = await prisma.chat.create({ data: { user1Id: userId, user2Id: otherUserId, isDirect: true, connectionId, lastMessageAt: new Date() } });
  return res.json({ success: true, chat: { id: chat.id } });
}

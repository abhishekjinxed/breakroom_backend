import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { notifyChatLeft } from "../socket";

const reportSchema = z.object({
  targetType: z.enum(["PULSE", "NOTE", "MESSAGE", "USER"]),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(1000).optional(),
});
const statusSchema = z.object({ status: z.enum(["REVIEWED", "DISMISSED"]) });

async function requireModerator(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const moderators = (process.env.MODERATOR_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return !!user?.email && moderators.includes(user.email.toLowerCase());
}

export async function reportContent(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Provide a report reason." });
  const report = await prisma.contentReport.create({ data: { reporterId: req.userId, ...parsed.data } });
  return res.status(201).json({ success: true, report });
}

export async function blockUser(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.userId !== "string") return res.status(400).json({ success: false, message: "Invalid user." });
  const blockedId = req.params.userId;
  if (req.userId === blockedId) return res.status(400).json({ success: false, message: "You cannot block yourself." });
  await prisma.$transaction(async (tx) => {
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: req.userId!, blockedId } }, create: { blockerId: req.userId!, blockedId }, update: {} });
    // Blocking is immediate: remove any direct connection so neither person
    // can continue sending messages through an already-open conversation.
    const chats = await tx.chat.findMany({ where: { isDirect: true, endedAt: null, OR: [{ user1Id: req.userId!, user2Id: blockedId }, { user1Id: blockedId, user2Id: req.userId! }] }, select: { id: true, connectionId: true } });
    if (chats.length) {
      await tx.chat.updateMany({ where: { id: { in: chats.map((chat) => chat.id) } }, data: { endedAt: new Date(), connectionId: null } });
      await tx.workCircleConnection.updateMany({ where: { id: { in: chats.map((chat) => chat.connectionId).filter((id): id is string => !!id) }, status: "ACCEPTED" }, data: { status: "REMOVED", respondedAt: new Date() } });
    }
  });
  return res.json({ success: true });
}

export async function acceptTerms(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await prisma.user.update({ where: { id: req.userId }, data: { termsAcceptedAt: new Date() }, select: { id: true, anonymousUsername: true, status: true, createdAt: true, lastActiveAt: true, termsAcceptedAt: true } });
  return res.json({ success: true, user });
}

export async function deleteMyAccount(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const userId = req.userId;
  const endedChats = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const chats = await tx.chat.findMany({
      where: { isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { id: true, user1Id: true, user2Id: true },
    });

    await tx.chat.updateMany({
      where: { id: { in: chats.map((chat) => chat.id) } },
      data: { endedAt: now, connectionId: null },
    });
    await tx.workCircleConnection.updateMany({
      where: { OR: [{ requesterId: userId }, { recipientId: userId }], status: { in: ["PENDING", "ACCEPTED"] } },
      data: { status: "REMOVED", respondedAt: now },
    });
    await tx.paperPlaneInvite.updateMany({
      where: { status: "PENDING", OR: [{ senderId: userId }, { recipientId: userId }] },
      data: { status: "CANCELLED", respondedAt: now },
    });
    await tx.coffeeQueue.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { deletedAt: now, status: "DEACTIVATED", termsAcceptedAt: null, lastActiveAt: now } });
    return chats;
  });

  for (const chat of endedChats) {
    const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
    notifyChatLeft(otherUserId, { chatId: chat.id });
  }
  return res.json({ success: true });
}

export async function getModeratorStatus(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  return res.json({ success: true, isModerator: await requireModerator(req.userId) });
}

async function getTargetPreview(targetType: string, targetId: string) {
  if (targetType === "PULSE") {
    const target = await prisma.workPulse.findUnique({ where: { id: targetId }, select: { text: true, author: { select: { anonymousUsername: true } } } });
    return target ? { label: "Pulse", text: target.text, author: target.author.anonymousUsername } : { label: "Pulse", text: "This content is no longer available." };
  }
  if (targetType === "NOTE") {
    const target = await prisma.pulseNote.findUnique({ where: { id: targetId }, select: { text: true, author: { select: { anonymousUsername: true } } } });
    return target ? { label: "Pulse note", text: target.text, author: target.author.anonymousUsername } : { label: "Pulse note", text: "This content is no longer available." };
  }
  if (targetType === "MESSAGE") {
    const target = await prisma.message.findUnique({ where: { id: targetId }, select: { text: true, sender: { select: { anonymousUsername: true } } } });
    return target ? { label: "Chat message", text: target.text, author: target.sender.anonymousUsername } : { label: "Chat message", text: "This content is no longer available." };
  }
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { anonymousUsername: true, bio: true, deletedAt: true } });
  return target
    ? { label: "Member profile", text: target.deletedAt ? "This account is deactivated." : target.bio || "No profile bio provided.", author: target.anonymousUsername }
    : { label: "Member profile", text: "This account is no longer available." };
}

export async function listReports(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || !(await requireModerator(req.userId))) return res.status(403).json({ success: false, message: "Moderator access required" });
  const reports = await prisma.contentReport.findMany({ take: 100, orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { reporter: { select: { id: true, anonymousUsername: true } } } });
  const reportsWithTargets = await Promise.all(reports.map(async (report) => ({ ...report, target: await getTargetPreview(report.targetType, report.targetId) })));
  return res.json({ success: true, reports: reportsWithTargets });
}

export async function resolveReport(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || !(await requireModerator(req.userId)) || typeof req.params.reportId !== "string") return res.status(403).json({ success: false, message: "Moderator access required" });
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid moderation status" });
  const report = await prisma.contentReport.update({ where: { id: req.params.reportId }, data: { status: parsed.data.status, reviewedAt: new Date() } });
  return res.json({ success: true, report });
}

import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { disconnectUserSockets, notifyChatLeft } from "../socket";
import { Prisma, ReportTargetType } from "@prisma/client";
import { createAppNotification } from "../services/notification.service";

const reportSchema = z.object({
  targetType: z.enum(["PULSE", "NOTE", "MESSAGE", "USER", "STICKY_NOTE", "STICKY_COMMENT"]),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(1000).optional(),
});
const statusSchema = z.object({ status: z.enum(["REVIEWED", "DISMISSED"]) });
const moderationActionSchema = z.object({ action: z.literal("DISABLE") });

async function requireModerator(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const moderators = (process.env.MODERATOR_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return !!user?.email && moderators.includes(user.email.toLowerCase());
}

const targetLabels: Record<ReportTargetType, string> = {
  PULSE: "Retired Pulse content",
  NOTE: "Retired Pulse note",
  MESSAGE: "chat message",
  USER: "member profile",
  STICKY_NOTE: "Desk Note",
  STICKY_COMMENT: "Desk Note comment",
  COFFEE_MESSAGE: "Retired Coffee Break message",
};

async function findTargetAuthorId(tx: Prisma.TransactionClient, targetType: ReportTargetType, targetId: string) {
  if (targetType === "PULSE" || targetType === "NOTE") return undefined;
  if (targetType === "MESSAGE") return (await tx.message.findUnique({ where: { id: targetId }, select: { senderId: true } }))?.senderId;
  if (targetType === "STICKY_NOTE") return (await tx.deskStickyNote.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId;
  if (targetType === "STICKY_COMMENT") return (await tx.stickyNoteComment.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId;
  return (await tx.user.findUnique({ where: { id: targetId }, select: { id: true } }))?.id;
}

export async function reportContent(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Provide a report reason." });
  if (parsed.data.targetType === "MESSAGE") {
    const message = await prisma.message.findFirst({ where: { id: parsed.data.targetId, chat: { OR: [{ user1Id: req.userId }, { user2Id: req.userId }] } }, select: { id: true } });
    if (!message) return res.status(404).json({ success: false, message: "That chat message is unavailable." });
  }
  const report = await prisma.contentReport.create({ data: { reporterId: req.userId, ...parsed.data } });
  return res.status(201).json({ success: true, report });
}

export async function blockUser(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.userId !== "string") return res.status(400).json({ success: false, message: "Invalid user." });
  const blockedId = req.params.userId;
  if (req.userId === blockedId) return res.status(400).json({ success: false, message: "You cannot block yourself." });
  await prisma.$transaction(async (tx) => {
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: req.userId!, blockedId } }, create: { blockerId: req.userId!, blockedId }, update: {} });
    // Blocking is immediate: close any private Paper Plane conversation.
    const chats = await tx.chat.findMany({ where: { isDirect: true, endedAt: null, OR: [{ user1Id: req.userId!, user2Id: blockedId }, { user1Id: blockedId, user2Id: req.userId! }] }, select: { id: true } });
    if (chats.length) {
      await tx.chat.updateMany({ where: { id: { in: chats.map((chat) => chat.id) } }, data: { endedAt: new Date() } });
    }
  });
  return res.json({ success: true });
}

/** Administrative account blocks are reserved for authorized moderators. */
export async function disableMemberAccount(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || !(await requireModerator(req.userId)) || typeof req.params.userId !== "string") return res.status(403).json({ success: false, message: "Moderator access required" });
  const userId = req.params.userId;
  if (userId === req.userId) return res.status(400).json({ success: false, message: "You cannot disable your own moderator account." });
  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, status: true } });
    if (!member) return null;
    const now = new Date();
    const chats = await tx.chat.findMany({ where: { isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] }, select: { id: true, user1Id: true, user2Id: true } });
    await tx.chat.updateMany({ where: { id: { in: chats.map((chat) => chat.id) } }, data: { endedAt: now } });
    await tx.paperPlaneInvite.updateMany({ where: { status: "PENDING", OR: [{ senderId: userId }, { recipientId: userId }] }, data: { status: "CANCELLED", respondedAt: now } });
    const report = await tx.contentReport.create({ data: { reporterId: req.userId!, targetType: "USER", targetId: userId, reason: "Moderator account block", details: "Account disabled directly by an authorized moderator." } });
    await tx.moderationAction.upsert({ where: { targetType_targetId: { targetType: "USER", targetId: userId } }, create: { reportId: report.id, targetType: "USER", targetId: userId, authorId: userId, reason: "Moderator account block" }, update: {} });
    await tx.user.update({ where: { id: userId }, data: { status: "DEACTIVATED", lastActiveAt: now } });
    await tx.contentReport.update({ where: { id: report.id }, data: { status: "ACTIONED", reviewedAt: now } });
    return { chats, alreadyDisabled: member.status === "DEACTIVATED" };
  });
  if (!result) return res.status(404).json({ success: false, message: "Member not found." });
  for (const chat of result.chats) notifyChatLeft(chat.user1Id === userId ? chat.user2Id : chat.user1Id, { chatId: chat.id });
  disconnectUserSockets(userId, "Your account has been disabled by an administrator for not following Breakroom’s Terms of Use.");
  await createAppNotification({ userId, type: "MODERATION_ACTION", title: "Account disabled by Breakroom", detail: "Your account was disabled by an administrator for not following Breakroom’s Terms of Use.", link: "/terms" });
  return res.json({ success: true, alreadyDisabled: result.alreadyDisabled });
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
      data: { endedAt: now },
    });
    await tx.paperPlaneInvite.updateMany({
      where: { status: "PENDING", OR: [{ senderId: userId }, { recipientId: userId }] },
      data: { status: "CANCELLED", respondedAt: now },
    });
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
  if (targetType === "PULSE" || targetType === "NOTE") return { label: "Retired content", text: "This legacy content is no longer available." };
  if (targetType === "MESSAGE") {
    const target = await prisma.message.findUnique({ where: { id: targetId }, select: { text: true, sender: { select: { anonymousUsername: true } } } });
    return target ? { label: "Chat message", text: target.text, author: target.sender.anonymousUsername } : { label: "Chat message", text: "This content is no longer available." };
  }
  if (targetType === "COFFEE_MESSAGE") return { label: "Retired Coffee Break message", text: "This legacy temporary message is no longer available." };
  if (targetType === "STICKY_NOTE") {
    const target = await prisma.deskStickyNote.findUnique({ where: { id: targetId }, select: { text: true, author: { select: { anonymousUsername: true } } } });
    return target ? { label: "Desk Note", text: target.text, author: target.author.anonymousUsername } : { label: "Desk Note", text: "This content is no longer available." };
  }
  if (targetType === "STICKY_COMMENT") {
    const target = await prisma.stickyNoteComment.findUnique({ where: { id: targetId }, select: { text: true, author: { select: { anonymousUsername: true } } } });
    return target ? { label: "Desk Note comment", text: target.text, author: target.author.anonymousUsername } : { label: "Desk Note comment", text: "This content is no longer available." };
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
  const reportId = req.params.reportId;
  const status = statusSchema.safeParse(req.body);
  if (status.success) {
    const report = await prisma.contentReport.update({ where: { id: req.params.reportId }, data: { status: status.data.status, reviewedAt: new Date() } });
    return res.json({ success: true, report });
  }
  const action = moderationActionSchema.safeParse(req.body);
  if (!action.success) return res.status(400).json({ success: false, message: "Choose a valid moderation outcome." });

  const result = await prisma.$transaction(async (tx) => {
    const report = await tx.contentReport.findUnique({ where: { id: reportId } });
    if (!report) return null;
    const authorId = await findTargetAuthorId(tx, report.targetType, report.targetId);
    if (!authorId) return { missing: true };
    const existing = await tx.moderationAction.findUnique({ where: { targetType_targetId: { targetType: report.targetType, targetId: report.targetId } } });
    if (!existing) {
      await tx.moderationAction.create({ data: { reportId: report.id, targetType: report.targetType, targetId: report.targetId, authorId, reason: report.reason } });
      if (report.targetType === "USER") await tx.user.update({ where: { id: authorId }, data: { status: "DEACTIVATED", lastActiveAt: new Date() } });
    }
    const updated = await tx.contentReport.update({ where: { id: report.id }, data: { status: "ACTIONED", reviewedAt: new Date() } });
    return { report: updated, authorId, targetType: report.targetType, newlyDisabled: !existing };
  });
  if (!result || "missing" in result) return res.status(404).json({ success: false, message: "Reported content is no longer available." });
  if (result.newlyDisabled) {
    await createAppNotification({
      userId: result.authorId,
      type: "MODERATION_ACTION",
      title: "Content disabled by Breakroom",
      detail: `Your ${targetLabels[result.targetType]} was disabled by an administrator for not following Breakroom’s Terms of Use.`,
      link: "/notifications",
    });
  }
  return res.json({ success: true, report: result.report, disabled: true });
}

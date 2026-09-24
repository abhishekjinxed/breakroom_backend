import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { disconnectUserSockets, notifyChatLeft } from "../socket";
import { Prisma, ReportTargetType } from "@prisma/client";
import { createAppNotification } from "../services/notification.service";
import { requireRateLimit } from "../services/content-safety.service";

const reportSchema = z.object({
  targetType: z.enum(["PULSE", "NOTE", "MESSAGE", "USER", "STICKY_NOTE", "STICKY_COMMENT", "PROFILE_PHOTO", "PAPER_PLANE", "PROMPT_ANSWER"]),
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
  PROFILE_PHOTO: "profile photo",
  PAPER_PLANE: "Paper Plane",
  PROMPT_ANSWER: "friendship question answer",
  COFFEE_MESSAGE: "Retired Coffee Break message",
};

async function findTargetAuthorId(tx: Prisma.TransactionClient, targetType: ReportTargetType, targetId: string, reporterId?: string) {
  if (targetType === "PULSE" || targetType === "NOTE") return undefined;
  if (targetType === "MESSAGE") {
    if (!reporterId) return undefined;
    return (await tx.message.findFirst({ where: { id: targetId, chat: { OR: [{ user1Id: reporterId }, { user2Id: reporterId }] } }, select: { senderId: true } }))?.senderId;
  }
  if (targetType === "STICKY_NOTE") return (await tx.deskStickyNote.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId;
  if (targetType === "STICKY_COMMENT") return (await tx.stickyNoteComment.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId;
  if (targetType === "PROFILE_PHOTO") return (await tx.profilePhoto.findUnique({ where: { id: targetId }, select: { ownerId: true } }))?.ownerId;
  if (targetType === "PAPER_PLANE") return (await tx.paperPlaneInvite.findFirst({ where: { id: targetId, recipientId: reporterId }, select: { senderId: true } }))?.senderId;
  if (targetType === "PROMPT_ANSWER") {
    if (!reporterId) return undefined;
    const prompt = await tx.conversationPrompt.findFirst({ where: { id: targetId, chat: { OR: [{ user1Id: reporterId }, { user2Id: reporterId }] } }, include: { chat: { select: { user1Id: true, user2Id: true } } } });
    if (!prompt) return undefined;
    const reporterIsFirst = prompt.chat.user1Id === reporterId;
    const answerByOther = reporterIsFirst ? prompt.user2Answer : prompt.user1Answer;
    return answerByOther ? (reporterIsFirst ? prompt.chat.user2Id : prompt.chat.user1Id) : undefined;
  }
  return (await tx.user.findUnique({ where: { id: targetId }, select: { id: true } }))?.id;
}

export async function reportContent(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Provide a report reason." });
  try { await requireRateLimit(req.userId, "report"); }
  catch { return res.status(429).json({ success: false, message: "You have reached the report limit for now." }); }
  const authorId = await findTargetAuthorId(prisma, parsed.data.targetType, parsed.data.targetId, req.userId);
  if (!authorId || authorId === req.userId) return res.status(404).json({ success: false, message: "That content is unavailable to report." });
  if (parsed.data.targetType === "PROFILE_PHOTO") {
    const visible = await prisma.profilePhoto.findFirst({ where: { id: parsed.data.targetId, OR: [{ visibility: "PUBLIC" }, { shares: { some: { recipientId: req.userId } } }] }, select: { id: true } });
    if (!visible) return res.status(404).json({ success: false, message: "That photo is unavailable to report." });
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
  if (targetType === "PROFILE_PHOTO") {
    const photo = await prisma.profilePhoto.findUnique({ where: { id: targetId }, select: { url: true, owner: { select: { anonymousUsername: true } } } });
    return photo ? { label: "Profile photo", text: "Reported profile photo", imageUrl: photo.url, author: photo.owner.anonymousUsername } : { label: "Profile photo", text: "This content is no longer available." };
  }
  if (targetType === "PAPER_PLANE") {
    const plane = await prisma.paperPlaneInvite.findUnique({ where: { id: targetId }, select: { message: true, sender: { select: { anonymousUsername: true } } } });
    return plane ? { label: "Paper Plane", text: plane.message, author: plane.sender.anonymousUsername } : { label: "Paper Plane", text: "This content is no longer available." };
  }
  if (targetType === "PROMPT_ANSWER") {
    const prompt = await prisma.conversationPrompt.findUnique({ where: { id: targetId }, select: { question: true, user1Answer: true, user2Answer: true, chat: { select: { user1: { select: { anonymousUsername: true } }, user2: { select: { anonymousUsername: true } } } } } });
    return prompt ? { label: "Friendship question answer", text: `${prompt.question}\n\n${prompt.chat.user1.anonymousUsername}: ${prompt.user1Answer ?? "(no answer)"}\n${prompt.chat.user2.anonymousUsername}: ${prompt.user2Answer ?? "(no answer)"}` } : { label: "Friendship question answer", text: "This content is no longer available." };
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
    const authorId = await findTargetAuthorId(tx, report.targetType, report.targetId, report.reporterId);
    if (!authorId) return { missing: true };
    const existing = await tx.moderationAction.findUnique({ where: { targetType_targetId: { targetType: report.targetType, targetId: report.targetId } } });
    let chatsToNotify: Array<{ id: string; user1Id: string; user2Id: string }> = [];
    if (!existing) {
      await tx.moderationAction.create({ data: { reportId: report.id, targetType: report.targetType, targetId: report.targetId, authorId, reason: report.reason } });
      if (report.targetType === "USER") {
        const now = new Date();
        await tx.user.update({ where: { id: authorId }, data: { status: "DEACTIVATED", lastActiveAt: now } });
        chatsToNotify = await tx.chat.findMany({ where: { isDirect: true, endedAt: null, OR: [{ user1Id: authorId }, { user2Id: authorId }] }, select: { id: true, user1Id: true, user2Id: true } });
        await tx.chat.updateMany({ where: { id: { in: chatsToNotify.map((chat) => chat.id) } }, data: { endedAt: now } });
        await tx.paperPlaneInvite.updateMany({ where: { status: "PENDING", OR: [{ senderId: authorId }, { recipientId: authorId }] }, data: { status: "CANCELLED", respondedAt: now } });
      }
      if (report.targetType === "PROFILE_PHOTO") await tx.profilePhoto.updateMany({ where: { id: report.targetId }, data: { visibility: "PRIVATE" } });
      if (report.targetType === "PAPER_PLANE") await tx.paperPlaneInvite.updateMany({ where: { id: report.targetId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
    }
    const updated = await tx.contentReport.update({ where: { id: report.id }, data: { status: "ACTIONED", reviewedAt: new Date() } });
    return { report: updated, authorId, targetType: report.targetType, newlyDisabled: !existing, chatsToNotify };
  });
  if (!result || "missing" in result) return res.status(404).json({ success: false, message: "Reported content is no longer available." });
  if (result.newlyDisabled) {
    const isAccountBlock = result.targetType === "USER";
    await createAppNotification({
      userId: result.authorId,
      type: "MODERATION_ACTION",
      title: isAccountBlock ? "Account disabled by Breakroom" : "Content disabled by Breakroom",
      detail: isAccountBlock ? "Your account was disabled by an administrator for not following Breakroom’s Terms of Use." : `Your ${targetLabels[result.targetType]} was disabled by an administrator for not following Breakroom’s Terms of Use.`,
      link: isAccountBlock ? "/terms" : "/notifications",
    });
    if (result.targetType === "USER") {
      for (const chat of result.chatsToNotify) notifyChatLeft(chat.user1Id === result.authorId ? chat.user2Id : chat.user1Id, { chatId: chat.id });
      disconnectUserSockets(result.authorId, "Your account has been disabled by an administrator for not following Breakroom’s Terms of Use.");
    }
  }
  return res.json({ success: true, report: result.report, disabled: true });
}

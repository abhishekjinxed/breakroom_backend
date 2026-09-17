import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { createAppNotification } from "../services/notification.service";
import { authorRemovalText, disabledTargetIdsFor, moderatorRemovalText } from "../services/moderation.service";
import { requireRateLimit, requireSafeText, safetyErrorMessage } from "../services/content-safety.service";

const stickySchema = z.object({ text: z.string().trim().min(1).max(160) });
const commentSchema = z.object({ text: z.string().trim().min(1).max(300) });
const replySchema = z.object({ text: z.string().trim().min(1).max(240) });

const stickyInclude = (userId: string) => ({
  author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } },
  comments: { include: { author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } }, orderBy: { createdAt: "asc" as const }, take: 20 },
  _count: { select: { applauds: true } },
  applauds: { where: { userId }, select: { userId: true } },
});

function payload(note: any, disabled: { STICKY_NOTE: string[]; STICKY_COMMENT: string[] }) {
  const { applauds, ...rest } = note;
  const moderatorRemoved = disabled.STICKY_NOTE.includes(note.id);
  const authorRemoved = !!note.deletedAt;
  return {
    ...rest,
    text: moderatorRemoved ? moderatorRemovalText() : authorRemoved ? authorRemovalText() : note.text,
    isUnavailable: moderatorRemoved || authorRemoved,
    unavailableReason: moderatorRemoved ? "MODERATOR" : authorRemoved ? "AUTHOR" : null,
    comments: note.comments.map((comment: any) => disabled.STICKY_COMMENT.includes(comment.id)
      ? { ...comment, text: moderatorRemovalText(), authorReply: null, isUnavailable: true, unavailableReason: "MODERATOR" }
      : { ...comment, isUnavailable: false, unavailableReason: null }),
    applaudedByMe: applauds.length > 0,
  };
}

async function blockedIds(userId: string) {
  const blocks = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  return blocks.map((block) => block.blockerId === userId ? block.blockedId : block.blockerId);
}

export async function listStickyNotes(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const hiddenAuthors = await blockedIds(req.userId);
  const disabled = await disabledTargetIdsFor(["STICKY_NOTE", "STICKY_COMMENT"]);
  const notes = await prisma.deskStickyNote.findMany({ where: { author: { deletedAt: null, status: { not: "DEACTIVATED" } }, ...(hiddenAuthors.length ? { authorId: { notIn: hiddenAuthors } } : {}) }, orderBy: { createdAt: "desc" }, take: 50, include: stickyInclude(req.userId) });
  return res.json({ success: true, notes: notes.map((note) => payload(note, disabled)) });
}

export async function listMyStickyNotes(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const disabled = await disabledTargetIdsFor(["STICKY_NOTE", "STICKY_COMMENT"]);
  const notes = await prisma.deskStickyNote.findMany({ where: { authorId: req.userId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100, include: stickyInclude(req.userId) });
  return res.json({ success: true, notes: notes.map((note) => payload(note, disabled)) });
}

export async function createStickyNote(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = stickySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a Desk Note up to 160 characters." });
  try { await requireSafeText(req.userId, parsed.data.text, "Desk Note"); await requireRateLimit(req.userId, "note"); } catch (error) { const message = safetyErrorMessage(error); if (message) return res.status(429).json({ success: false, message }); throw error; }
  const note = await prisma.deskStickyNote.create({ data: { authorId: req.userId, text: parsed.data.text }, include: stickyInclude(req.userId) });
  return res.status(201).json({ success: true, note: payload(note, { STICKY_NOTE: [], STICKY_COMMENT: [] }) });
}

export async function toggleStickyApplaud(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.noteId !== "string") return res.status(400).json({ success: false, message: "Invalid Desk Note." });
  const disabled = await disabledTargetIdsFor(["STICKY_NOTE"]);
  if (disabled.STICKY_NOTE.includes(req.params.noteId)) return res.status(404).json({ success: false, message: "Desk Note unavailable." });
  const note = await prisma.deskStickyNote.findFirst({ where: { id: req.params.noteId, deletedAt: null, author: { deletedAt: null } }, select: { id: true } });
  if (!note) return res.status(404).json({ success: false, message: "Desk Note not found." });
  const existing = await prisma.stickyNoteApplaud.findUnique({ where: { userId_stickyNoteId: { userId: req.userId, stickyNoteId: note.id } } });
  if (existing) await prisma.stickyNoteApplaud.delete({ where: { userId_stickyNoteId: { userId: req.userId, stickyNoteId: note.id } } });
  else await prisma.stickyNoteApplaud.create({ data: { userId: req.userId, stickyNoteId: note.id } });
  return res.json({ success: true, applauded: !existing, applauds: await prisma.stickyNoteApplaud.count({ where: { stickyNoteId: note.id } }) });
}

export async function addStickyComment(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.noteId !== "string") return res.status(400).json({ success: false, message: "Invalid Desk Note." });
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a comment up to 300 characters." });
  try { await requireSafeText(req.userId, parsed.data.text, "Desk Note comment"); await requireRateLimit(req.userId, "comment"); } catch (error) { const message = safetyErrorMessage(error); if (message) return res.status(429).json({ success: false, message }); throw error; }
  const disabled = await disabledTargetIdsFor(["STICKY_NOTE"]);
  if (disabled.STICKY_NOTE.includes(req.params.noteId)) return res.status(404).json({ success: false, message: "Desk Note unavailable." });
  const note = await prisma.deskStickyNote.findFirst({ where: { id: req.params.noteId, deletedAt: null, author: { deletedAt: null } }, select: { id: true, authorId: true } });
  if (!note) return res.status(404).json({ success: false, message: "Desk Note not found." });
  const comment = await prisma.stickyNoteComment.create({ data: { stickyNoteId: note.id, authorId: req.userId, text: parsed.data.text }, include: { author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } } });
  if (note.authorId !== req.userId) {
    await createAppNotification({
      userId: note.authorId,
      type: "STICKY_NOTE_COMMENT",
      title: "New comment on your Desk Note",
      detail: `${comment.author.anonymousUsername}: ${comment.text}`,
      link: "/desk-notes",
    });
  }
  return res.status(201).json({ success: true, comment });
}

export async function replyToStickyComment(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.noteId !== "string" || typeof req.params.commentId !== "string") return res.status(400).json({ success: false, message: "Invalid Desk Note comment." });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a reply up to 240 characters." });
  try { await requireSafeText(req.userId, parsed.data.text, "Desk Note comment"); await requireRateLimit(req.userId, "comment"); } catch (error) { const message = safetyErrorMessage(error); if (message) return res.status(429).json({ success: false, message }); throw error; }
  const note = await prisma.deskStickyNote.findFirst({ where: { id: req.params.noteId, authorId: req.userId }, select: { id: true } });
  if (!note) return res.status(403).json({ success: false, message: "Only the Desk Note author can reply." });
  const updated = await prisma.stickyNoteComment.updateMany({ where: { id: req.params.commentId, stickyNoteId: note.id, authorReply: null }, data: { authorReply: parsed.data.text, authorRepliedAt: new Date() } });
  if (!updated.count) return res.status(409).json({ success: false, message: "This comment already has a reply or is unavailable." });
  const comment = await prisma.stickyNoteComment.findUniqueOrThrow({ where: { id: req.params.commentId }, include: { author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } } });
  if (comment.authorId !== req.userId) {
    await createAppNotification({
      userId: comment.authorId,
      type: "STICKY_NOTE_REPLY",
      title: "Reply to your Desk Note comment",
      detail: `The note author replied: ${comment.authorReply ?? ""}`,
      link: "/desk-notes",
    });
  }
  return res.json({ success: true, comment });
}

export async function deleteStickyNote(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.noteId !== "string") return res.status(400).json({ success: false, message: "Invalid Desk Note." });
  const deleted = await prisma.deskStickyNote.updateMany({ where: { id: req.params.noteId, authorId: req.userId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!deleted.count) return res.status(404).json({ success: false, message: "Desk Note not found or unavailable." });
  return res.json({ success: true });
}

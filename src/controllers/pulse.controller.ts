import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { disabledTargetIdsFor } from "../services/moderation.service";

const pulseSchema = z.object({
  text: z.string().trim().max(200),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
  locationLabel: z.string().trim().min(1).max(160).optional(),
  isBreakBrief: z.boolean().optional(),
}).refine((value) => value.text.length > 0 || value.mediaUrl, { message: "Add a message or media." });

const noteSchema = z.object({ text: z.string().trim().min(1).max(500) });

const pulseInclude = (userId: string, disabledNotes: string[] = []) => ({
  author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } },
  notes: { where: disabledNotes.length ? { id: { notIn: disabledNotes } } : undefined, include: { author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } }, orderBy: { createdAt: "asc" as const } },
  _count: { select: { applauds: true } },
  applauds: { where: { userId }, select: { userId: true } },
});

export async function listPulses(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const blocks = await prisma.userBlock.findMany({ where: { blockerId: req.userId }, select: { blockedId: true } });
  const blockedIds = blocks.map((block) => block.blockedId);
  const disabled = await disabledTargetIdsFor(["PULSE", "NOTE"]);
  const pulses = await prisma.workPulse.findMany({ where: { isBreakBrief: req.query.briefs === "true", author: { status: { not: "DEACTIVATED" } }, ...(disabled.PULSE.length ? { id: { notIn: disabled.PULSE } } : {}), ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}) }, orderBy: { createdAt: "desc" }, include: pulseInclude(req.userId, disabled.NOTE) });
  return res.json({ success: true, pulses: pulses.map(({ applauds, ...pulse }) => ({ ...pulse, applaudedByMe: applauds.length > 0 })) });
}

export async function createPulse(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = pulseSchema.safeParse(req.body);
  if (!parsed.success || (!!parsed.data.mediaUrl !== !!parsed.data.mediaType)) return res.status(400).json({ success: false, message: "Add a valid message or media attachment." });
  if (parsed.data.isBreakBrief && parsed.data.mediaType !== "VIDEO") return res.status(400).json({ success: false, message: "Break Briefs require a video." });
  if (parsed.data.isBreakBrief && !parsed.data.mediaUrl?.includes("/video/upload/so_0,eo_10/")) return res.status(400).json({ success: false, message: "Break Briefs must be trimmed to 10 seconds." });
  if (!parsed.data.isBreakBrief && parsed.data.mediaType === "VIDEO") return res.status(400).json({ success: false, message: "Office Pulses support one photo and text only." });
  if (!parsed.data.isBreakBrief && parsed.data.text.length > 160) return res.status(400).json({ success: false, message: "Office Pulse text is limited to 160 characters." });
  const pulse = await prisma.workPulse.create({ data: { authorId: req.userId, ...parsed.data }, include: pulseInclude(req.userId) });
  const { applauds, ...payload } = pulse;
  return res.status(201).json({ success: true, pulse: { ...payload, applaudedByMe: false } });
}

export async function toggleApplaud(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const pulseId = req.params.pulseId;
  if (typeof pulseId !== "string") return res.status(400).json({ success: false, message: "Invalid Work Pulse" });
  const disabledPulses = await disabledTargetIdsFor(["PULSE"]);
  if (disabledPulses.PULSE.includes(pulseId)) return res.status(404).json({ success: false, message: "This Work Pulse is unavailable." });
  const existing = await prisma.pulseApplaud.findUnique({ where: { userId_pulseId: { userId: req.userId, pulseId } } });
  if (existing) await prisma.pulseApplaud.delete({ where: { userId_pulseId: { userId: req.userId, pulseId } } });
  else await prisma.pulseApplaud.create({ data: { userId: req.userId, pulseId } });
  const applauds = await prisma.pulseApplaud.count({ where: { pulseId } });
  return res.json({ success: true, applauded: !existing, applauds });
}

export async function addNote(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const pulseId = req.params.pulseId;
  const parsed = noteSchema.safeParse(req.body);
  if (typeof pulseId !== "string" || !parsed.success) return res.status(400).json({ success: false, message: "A note is required." });
  const disabledPulses = await disabledTargetIdsFor(["PULSE"]);
  if (disabledPulses.PULSE.includes(pulseId)) return res.status(404).json({ success: false, message: "This Work Pulse is unavailable." });
  const note = await prisma.pulseNote.create({ data: { pulseId, authorId: req.userId, text: parsed.data.text }, include: { author: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } } });
  return res.status(201).json({ success: true, note });
}

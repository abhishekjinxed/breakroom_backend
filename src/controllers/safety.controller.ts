import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const reportSchema = z.object({
  targetType: z.enum(["PULSE", "NOTE", "MESSAGE", "USER"]),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(1000).optional(),
});

export async function reportContent(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Provide a report reason." });
  const report = await prisma.contentReport.create({ data: { reporterId: req.userId, ...parsed.data } });
  return res.status(201).json({ success: true, report });
}

export async function blockUser(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.userId !== "string") return res.status(400).json({ success: false, message: "Invalid user." });
  if (req.userId === req.params.userId) return res.status(400).json({ success: false, message: "You cannot block yourself." });
  await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: req.userId, blockedId: req.params.userId } }, create: { blockerId: req.userId, blockedId: req.params.userId }, update: {} });
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
  await prisma.$transaction(async (tx) => {
    const chats = await tx.chat.findMany({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] }, select: { id: true } });
    if (chats.length) {
      const chatIds = chats.map((chat) => chat.id);
      await tx.message.deleteMany({ where: { chatId: { in: chatIds } } });
      await tx.chat.deleteMany({ where: { id: { in: chatIds } } });
    }
    await tx.user.delete({ where: { id: userId } });
  });
  return res.json({ success: true });
}

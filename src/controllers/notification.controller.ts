import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

export async function listNotifications(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const notifications = await prisma.appNotification.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, detail: true, link: true, readAt: true, createdAt: true },
  });
  return res.json({ success: true, notifications });
}

export async function markNotificationsRead(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await prisma.appNotification.updateMany({ where: { userId: req.userId, readAt: null }, data: { readAt: new Date() } });
  return res.json({ success: true });
}

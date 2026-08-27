import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "./auth.middleware";

export async function requireTermsAcceptance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { termsAcceptedAt: true } });
  if (!user?.termsAcceptedAt) return res.status(403).json({ success: false, message: "Accept the Terms of Use before using community features." });
  next();
}

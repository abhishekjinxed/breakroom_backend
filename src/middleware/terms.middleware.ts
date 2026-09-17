import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "./auth.middleware";

export async function requireTermsAcceptance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { termsAcceptedAt: true, dateOfBirth: true } });
  if (!user?.termsAcceptedAt) return res.status(403).json({ success: false, message: "Accept the Terms of Use before using community features." });
  if (!user.dateOfBirth || ageAtLeast(user.dateOfBirth, 18) === false) return res.status(403).json({ success: false, message: "Breakroom community features are available only to members aged 18 and over. Add a valid date of birth in Account." });
  next();
}

function ageAtLeast(dateOfBirth: Date, age: number) {
  const today = new Date();
  const threshold = new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()));
  return dateOfBirth <= threshold;
}

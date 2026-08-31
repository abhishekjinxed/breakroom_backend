import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { PAPER_PLANE_COST, STARTING_PAISA } from "../lib/paisa";

export async function getWallet(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const wallet = await prisma.paisaWallet.upsert({
    where: { userId: req.userId },
    create: { userId: req.userId, balance: STARTING_PAISA },
    update: {},
    select: { balance: true },
  });
  return res.json({ success: true, balance: wallet.balance, currency: "Paisa", paperPlaneCost: PAPER_PLANE_COST });
}

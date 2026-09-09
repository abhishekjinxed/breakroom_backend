import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const pushTokenSchema = z.object({
  token: z.string().regex(/^(Exponent|Expo)PushToken\[[^\]]+\]$/, "Invalid Expo push token."),
  platform: z.literal("android"),
});

export async function registerPushDevice(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = pushTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid Android notification device." });
  await prisma.pushDevice.upsert({
    where: { token: parsed.data.token },
    create: { userId: req.userId, ...parsed.data },
    update: { userId: req.userId, platform: parsed.data.platform },
  });
  return res.json({ success: true });
}

export async function unregisterPushDevice(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = z.object({ token: z.string().max(255) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid Android notification device." });
  await prisma.pushDevice.deleteMany({ where: { userId: req.userId, token: parsed.data.token } });
  return res.json({ success: true });
}

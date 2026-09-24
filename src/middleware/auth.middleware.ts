import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

const lastPresenceWrite = new Map<string, number>();
const PRESENCE_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function refreshPresence(userId: string) {
  const now = Date.now();
  const lastWrite = lastPresenceWrite.get(userId) ?? 0;
  if (now - lastWrite < PRESENCE_WRITE_INTERVAL_MS) return;
  lastPresenceWrite.set(userId, now);
  // Presence is best-effort and should never make an otherwise valid request
  // fail. Avoid a database write on every API call from active users.
  prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date(now) } }).catch(() => undefined);
  if (lastPresenceWrite.size > 20_000) {
    const oldestUserId = lastPresenceWrite.keys().next().value;
    if (oldestUserId) lastPresenceWrite.delete(oldestUserId);
  }
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const [type, token] = authorization.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization header",
      });
    }

    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { deletedAt: true, status: true } });
    if (!user || user.deletedAt) {
      return res.status(401).json({ success: false, message: "Account is no longer active" });
    }
    if (user.status === "DEACTIVATED") {
      return res.status(403).json({ success: false, message: "Your account has been disabled by an administrator for not following Breakroom’s Terms of Use." });
    }

    // Presence drives random Paper Plane delivery. Refresh it for every
    // authenticated request so an open, signed-in desk is eligible.
    refreshPresence(payload.userId);

    req.userId = payload.userId;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

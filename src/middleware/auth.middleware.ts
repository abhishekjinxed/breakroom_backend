import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthenticatedRequest extends Request {
  userId?: string;
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

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) {
      return res.status(401).json({ success: false, message: "Account is no longer active" });
    }

    // Presence drives random Paper Plane delivery. Refresh it for every
    // authenticated request so an open, signed-in desk is eligible.
    await prisma.user.update({ where: { id: payload.userId }, data: { lastActiveAt: new Date() } });

    req.userId = payload.userId;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

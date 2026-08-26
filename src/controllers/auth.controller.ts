import { Request, Response } from "express";
import { createAnonymousUser } from "../services/auth.service";
import { createToken } from "../lib/auth";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma";
const googleClient = new OAuth2Client();

export async function googleLogin(req: Request, res: Response) {
  try {
    const idToken = req.body?.idToken;
    const audiences = [process.env.GOOGLE_WEB_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter((value): value is string => Boolean(value));
    if (!idToken || audiences.length === 0) return res.status(400).json({ success: false, message: "Google sign-in is not configured" });
    const ticket = await googleClient.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) return res.status(401).json({ success: false, message: "Invalid Google account" });
    let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
    if (!user) {
      const username = `Professional${Math.floor(100000 + Math.random() * 900000)}`;
      user = await prisma.user.create({ data: { googleId: payload.sub, email: payload.email, anonymousUsername: username } });
    }
    return res.json({ success: true, token: createToken(user.id), user });
  } catch (error) {
    console.error("Google sign-in verification failed:", error);
    return res.status(401).json({ success: false, message: "Google sign-in failed" });
  }
}

export async function anonymousLogin(
  _req: Request,
  res: Response
) {
  try {
    const user = await createAnonymousUser();

    const token = createToken(user.id);

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        anonymousUsername: user.anonymousUsername,
        status: user.status,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Anonymous login error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create anonymous user",
    });
  }
}

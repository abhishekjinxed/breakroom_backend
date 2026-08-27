import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { z } from "zod";

const profileSchema = z.object({
  bio: z.string().trim().max(160).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`) <= new Date(), "Enter a valid past date.").nullable().optional(),
  gender: z.enum(["Woman", "Man", "Non-binary", "Prefer not to say", "Self-describe"]).nullable().optional(),
  socialLink: z.string().trim().url().max(500).nullable().optional(),
});

const userSelect = {
  id: true,
  anonymousUsername: true,
  status: true,
  createdAt: true,
  lastActiveAt: true,
  termsAcceptedAt: true,
  bio: true,
  dateOfBirth: true,
  gender: true,
  socialLink: true,
} as const;

export async function getMe(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: req.userId,
      },
      select: userSelect,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get me error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
}

export async function updateMyProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Enter valid optional profile details." });

  const value = parsed.data;
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      bio: value.bio || null,
      dateOfBirth: value.dateOfBirth ? new Date(`${value.dateOfBirth}T00:00:00.000Z`) : null,
      gender: value.gender || null,
      socialLink: value.socialLink || null,
    },
    select: userSelect,
  });
  return res.json({ success: true, user });
}

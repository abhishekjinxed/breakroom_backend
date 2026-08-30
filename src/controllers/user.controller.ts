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

// Public profiles deliberately omit email, Google identity, date of birth, and
// presence data. Those fields are account-only and must not be discoverable.
const publicProfileSelect = {
  id: true,
  anonymousUsername: true,
  bio: true,
  gender: true,
  socialLink: true,
  createdAt: true,
  dateOfBirth: true,
} as const;

function ageFromDateOfBirth(dateOfBirth: Date | null) {
  if (!dateOfBirth) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < dateOfBirth.getUTCMonth() || (today.getUTCMonth() === dateOfBirth.getUTCMonth() && today.getUTCDate() < dateOfBirth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

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
  const { dateOfBirth, ...publicUser } = user;
  return res.json({ success: true, user: { ...publicUser, age: ageFromDateOfBirth(dateOfBirth) } });
}

export async function getPublicProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.userId !== "string") return res.status(400).json({ success: false, message: "Invalid member." });

  const userId = req.params.userId;
  const blocked = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: req.userId, blockedId: userId }, { blockerId: userId, blockedId: req.userId }] },
    select: { blockerId: true },
  });
  if (blocked) return res.status(404).json({ success: false, message: "Member not found." });

  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: publicProfileSelect });
  if (!user) return res.status(404).json({ success: false, message: "Member not found." });
  const { dateOfBirth, ...publicUser } = user;
  return res.json({ success: true, user: { ...publicUser, age: ageFromDateOfBirth(dateOfBirth) } });
}

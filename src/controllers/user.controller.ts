import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { z } from "zod";
import { disabledTargetIdsFor } from "../services/moderation.service";
import { requireSafeText, safetyErrorMessage } from "../services/content-safety.service";
import { getOnlineUserCount } from "../socket";

const profileSchema = z.object({
  publicAvatarUrl: z.string().trim().url().max(1000).refine((url) => new URL(url).hostname === "res.cloudinary.com", "Upload a Cloudinary image.").nullable().optional(),
  publicFlair: z.string().trim().max(40).nullable().optional(),
  bio: z.string().trim().max(160).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`) <= new Date(), "Enter a valid past date.").refine((value) => (ageFromDateOfBirth(new Date(`${value}T00:00:00.000Z`)) ?? 0) >= 18, "Breakroom is available only to members aged 18 and over.").nullable().optional(),
  gender: z.enum(["Woman", "Man", "Non-binary", "Prefer not to say", "Self-describe"]).nullable().optional(),
  socialLink: z.string().trim().url().max(500).nullable().optional(),
});
const photoCreateSchema = z.object({ url: z.string().url().max(1000).refine((url) => new URL(url).hostname === "res.cloudinary.com", "Upload a Cloudinary image."), visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE") });
const photoUpdateSchema = z.object({ visibility: z.enum(["PRIVATE", "PUBLIC"]) });

const userSelect = {
  id: true,
  anonymousUsername: true,
  status: true,
  createdAt: true,
  lastActiveAt: true,
  termsAcceptedAt: true,
  publicAvatarUrl: true,
  publicFlair: true,
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
  publicAvatarUrl: true,
  publicFlair: true,
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

const profilePhotoSelect = { id: true, url: true, visibility: true, createdAt: true } as const;

export async function listMyProfilePhotos(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const photos = await prisma.profilePhoto.findMany({ where: { ownerId: req.userId }, select: profilePhotoSelect, orderBy: { createdAt: "asc" } });
  return res.json({ success: true, photos });
}

export async function addMyProfilePhoto(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = photoCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Upload a valid Cloudinary image." });
  const existing = await prisma.profilePhoto.count({ where: { ownerId: req.userId } });
  if (existing >= 2) return res.status(400).json({ success: false, message: "You can keep up to two profile photos." });
  const photo = await prisma.profilePhoto.create({ data: { ownerId: req.userId, ...parsed.data }, select: profilePhotoSelect });
  return res.status(201).json({ success: true, photo });
}

export async function updateMyProfilePhoto(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.photoId !== "string") return res.status(400).json({ success: false, message: "Invalid profile photo." });
  const parsed = photoUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose a valid photo visibility." });
  const photo = await prisma.profilePhoto.updateMany({ where: { id: req.params.photoId, ownerId: req.userId }, data: parsed.data });
  if (!photo.count) return res.status(404).json({ success: false, message: "Profile photo not found." });
  return res.json({ success: true });
}

export async function deleteMyProfilePhoto(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.photoId !== "string") return res.status(400).json({ success: false, message: "Invalid profile photo." });
  const photo = await prisma.profilePhoto.deleteMany({ where: { id: req.params.photoId, ownerId: req.userId } });
  if (!photo.count) return res.status(404).json({ success: false, message: "Profile photo not found." });
  return res.json({ success: true });
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

export async function getBreakroomPulse(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  return res.json({ success: true, onlineCount: getOnlineUserCount() });
}

export async function updateMyProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Enter valid optional profile details." });

  const value = parsed.data;
  try {
    if (value.publicFlair) await requireSafeText(req.userId, value.publicFlair, "Profile");
    if (value.bio) await requireSafeText(req.userId, value.bio, "Profile");
  } catch (error) {
    const message = safetyErrorMessage(error);
    if (message) return res.status(400).json({ success: false, message });
    throw error;
  }
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      publicAvatarUrl: value.publicAvatarUrl || null,
      publicFlair: value.publicFlair || null,
      bio: value.bio || null,
      dateOfBirth: value.dateOfBirth ? new Date(`${value.dateOfBirth}T00:00:00.000Z`) : null,
      gender: value.gender || null,
      socialLink: value.socialLink || null,
    },
    select: userSelect,
  });
  return res.json({ success: true, user: { ...user, age: ageFromDateOfBirth(user.dateOfBirth) } });
}

export async function getPublicProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.userId !== "string") return res.status(400).json({ success: false, message: "Invalid member." });

  const userId = req.params.userId;
  const blocked = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: req.userId, blockedId: userId }, { blockerId: userId, blockedId: req.userId }] },
    select: { blockerId: true },
  });
  if (blocked) return res.status(404).json({ success: false, message: "Member not found." });

  let hasFullProfileAccess = userId === req.userId;
  if (userId !== req.userId) {
    const chat = await prisma.chat.findFirst({
      where: { isDirect: true, endedAt: null, OR: [{ user1Id: req.userId, user2Id: userId }, { user1Id: userId, user2Id: req.userId }] },
      select: { user1Id: true, user2Id: true, profileSharedByUser1: true, profileSharedByUser2: true },
    });
    const profileIsShared = chat && (chat.user1Id === userId ? chat.profileSharedByUser1 : chat.profileSharedByUser2);
    hasFullProfileAccess = !!profileIsShared;
  }

  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: { not: "DEACTIVATED" } }, select: publicProfileSelect });
  if (!user) return res.status(404).json({ success: false, message: "Member not found." });
  const disabled = await disabledTargetIdsFor(["STICKY_NOTE"]);
  const deskNoteExpiry = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deskNotes = await prisma.deskStickyNote.findMany({ where: { authorId: userId, deletedAt: null, OR: [{ createdAt: { gte: deskNoteExpiry } }, { pinnedAt: { not: null } }], ...(disabled.STICKY_NOTE.length ? { id: { notIn: disabled.STICKY_NOTE } } : {}) }, orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }], take: 20, select: { id: true, text: true, mood: true, pinnedAt: true, createdAt: true, _count: { select: { applauds: true, comments: true } } } });
  const profilePhotoCount = await prisma.profilePhoto.count({ where: { ownerId: userId } });
  const visiblePhotos = await prisma.profilePhoto.findMany({ where: { ownerId: userId, OR: [{ visibility: "PUBLIC" }, { shares: { some: { recipientId: req.userId } } }] }, select: { id: true, url: true, visibility: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  if (!hasFullProfileAccess && deskNotes.length === 0 && visiblePhotos.length === 0 && !user.publicAvatarUrl && !user.publicFlair) return res.status(404).json({ success: false, message: "Member not found." });
  const { dateOfBirth, ...publicUser } = user;
  return res.json({ success: true, user: { ...publicUser, bio: hasFullProfileAccess ? publicUser.bio : null, gender: hasFullProfileAccess ? publicUser.gender : null, socialLink: hasFullProfileAccess ? publicUser.socialLink : null, age: hasFullProfileAccess ? ageFromDateOfBirth(dateOfBirth) : null, deskNotes, photos: visiblePhotos, photoAvailability: { total: profilePhotoCount, visible: visiblePhotos.length }, limitedProfile: !hasFullProfileAccess } });
}

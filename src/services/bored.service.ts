import { prisma } from "../lib/prisma";
import { CHARTER_PLANE_COST, PAPER_PLANE_COST, STARTING_PAISA } from "../lib/paisa";
import { requireRateLimit, requireSafeText } from "./content-safety.service";

const PAPER_PLANE_TTL_MS = 24 * 60 * 60 * 1000;
const PAPER_PLANE_RECIPIENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;

export async function sendPaperPlane(senderId: string, message: string) {
  await requireSafeText(senderId, message, "Paper Plane");
  await requireRateLimit(senderId, "plane");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAPER_PLANE_TTL_MS);

  return prisma.$transaction(async (tx) => {
    await tx.paperPlaneInvite.updateMany({
      where: {
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: {
        status: "EXPIRED",
        respondedAt: now,
      },
    });

    const candidates = await tx.user.findMany({
      where: {
        id: { not: senderId },
        deletedAt: null,
        status: { in: ["ONLINE", "GETTING_BORED"] },
        lastActiveAt: { gte: new Date(now.getTime() - PAPER_PLANE_RECIPIENT_ACTIVITY_MS) },
        blocksCreated: { none: { blockedId: senderId } },
        blocksReceived: { none: { blockerId: senderId } },
      },
      select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true },
      take: 20,
      orderBy: { lastActiveAt: "desc" },
    });

    const recipient = candidates[Math.floor(Math.random() * candidates.length)];
    if (!recipient) {
      throw new Error("NO_AVAILABLE_RECIPIENT");
    }

    // Create a starter wallet lazily for existing users, then perform an
    // atomic conditional debit. This prevents parallel requests from sending
    // more planes than the virtual balance can cover.
    await tx.paisaWallet.upsert({ where: { userId: senderId }, create: { userId: senderId, balance: STARTING_PAISA }, update: {} });
    const debit = await tx.paisaWallet.updateMany({ where: { userId: senderId, balance: { gte: PAPER_PLANE_COST } }, data: { balance: { decrement: PAPER_PLANE_COST } } });
    if (!debit.count) throw new Error("INSUFFICIENT_PAISA");

    const invite = await tx.paperPlaneInvite.create({
      data: {
        senderId,
        recipientId: recipient.id,
        message,
        expiresAt,
      },
      include: {
        sender: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } },
      },
    });

    const wallet = await tx.paisaWallet.findUniqueOrThrow({ where: { userId: senderId }, select: { balance: true } });
    return { invite, recipient, balance: wallet.balance };
  });
}

export async function sendCharterPaperPlane(senderId: string, recipientId: string, message: string) {
  if (senderId === recipientId) throw new Error("INVALID_CHARTER_RECIPIENT");
  await requireSafeText(senderId, message, "Paper Plane");
  await requireRateLimit(senderId, "plane");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAPER_PLANE_TTL_MS);

  return prisma.$transaction(async (tx) => {
    await tx.paperPlaneInvite.updateMany({
      where: { status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", respondedAt: now },
    });

    const recipient = await tx.user.findFirst({
      where: {
        id: recipientId,
        deletedAt: null,
        blocksCreated: { none: { blockedId: senderId } },
        blocksReceived: { none: { blockerId: senderId } },
      },
      select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true },
    });
    if (!recipient) throw new Error("CHARTER_RECIPIENT_UNAVAILABLE");

    const existing = await tx.paperPlaneInvite.findFirst({
      where: { senderId, recipientId, isCharter: true, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (existing) throw new Error("CHARTER_ALREADY_SENT");

    await tx.paisaWallet.upsert({ where: { userId: senderId }, create: { userId: senderId, balance: STARTING_PAISA }, update: {} });
    const debit = await tx.paisaWallet.updateMany({ where: { userId: senderId, balance: { gte: CHARTER_PLANE_COST } }, data: { balance: { decrement: CHARTER_PLANE_COST } } });
    if (!debit.count) throw new Error("INSUFFICIENT_PAISA");

    const invite = await tx.paperPlaneInvite.create({
      data: {
        senderId,
        recipientId,
        message,
        isCharter: true,
        expiresAt,
      },
      include: { sender: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } } },
    });
    const wallet = await tx.paisaWallet.findUniqueOrThrow({ where: { userId: senderId }, select: { balance: true } });
    return { invite, recipient, balance: wallet.balance };
  });
}

export async function getPendingPaperPlanes(recipientId: string) {
  const now = new Date();
  await prisma.paperPlaneInvite.updateMany({
    where: { recipientId, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", respondedAt: now },
  });

  // A desk can hold several unopened planes. Keep them all available until
  // their 24-hour expiry rather than only returning the latest arrival.
  const invites = await prisma.paperPlaneInvite.findMany({
    where: { recipientId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      sender: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } },
    },
  });
  if (!invites.length) return invites;
  const disabled = new Set((await prisma.moderationAction.findMany({ where: { targetType: "PAPER_PLANE", targetId: { in: invites.map((invite) => invite.id) } }, select: { targetId: true } })).map((action) => action.targetId));
  return invites.filter((invite) => !disabled.has(invite.id));
}

export async function respondToPaperPlane(recipientId: string, inviteId: string, accept: boolean) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const invite = await tx.paperPlaneInvite.findUnique({
      where: { id: inviteId },
      include: {
        sender: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true, status: true } },
        recipient: { select: { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true, status: true } },
      },
    });

    if (!invite || invite.recipientId !== recipientId) throw new Error("PAPER_PLANE_NOT_FOUND");
    const disabled = await tx.moderationAction.findUnique({ where: { targetType_targetId: { targetType: "PAPER_PLANE", targetId: invite.id } }, select: { id: true } });
    if (disabled) throw new Error("PAPER_PLANE_UNAVAILABLE");
    if (invite.status !== "PENDING" || invite.expiresAt <= now) {
      if (invite.status === "PENDING") {
        await tx.paperPlaneInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED", respondedAt: now } });
      }
      throw new Error("PAPER_PLANE_UNAVAILABLE");
    }

    const claimedInvite = await tx.paperPlaneInvite.updateMany({
      where: { id: invite.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: now },
    });
    if (claimedInvite.count !== 1) throw new Error("PAPER_PLANE_UNAVAILABLE");

    if (!accept) return { accepted: false, senderId: invite.senderId };

    // A Paper Plane creates one private Inbox conversation for this pair.
    let chat = await tx.chat.findFirst({ where: { isDirect: true, endedAt: null, OR: [{ user1Id: invite.senderId, user2Id: recipientId }, { user1Id: recipientId, user2Id: invite.senderId }] }, orderBy: { lastMessageAt: "desc" } });
    if (!chat) chat = await tx.chat.create({ data: { user1Id: invite.senderId, user2Id: recipientId, isDirect: true, lastMessageAt: now } });

    return { accepted: true, chatId: chat.id, senderId: invite.senderId };
  });
}

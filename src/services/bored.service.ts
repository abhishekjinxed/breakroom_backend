import { prisma } from "../lib/prisma";
import { notifyMatch } from "../socket";
import { CHARTER_PLANE_COST, PAPER_PLANE_COST, STARTING_PAISA } from "../lib/paisa";

const PAPER_PLANE_TTL_MS = 24 * 60 * 60 * 1000;
const PAPER_PLANE_RECIPIENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;

export async function joinBoredQueue(userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!currentUser) {
      throw new Error("USER_NOT_FOUND");
    }

    if (currentUser.status === "IN_CHAT") {
      const activeChat = await tx.chat.findFirst({
        where: {
          endedAt: null,
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        orderBy: { createdAt: "desc" },
      });

      if (activeChat) {
        const otherUserId =
          activeChat.user1Id === userId
            ? activeChat.user2Id
            : activeChat.user1Id;

        const otherUser = await tx.user.findUniqueOrThrow({
          where: { id: otherUserId },
          select: { id: true, anonymousUsername: true },
        });

        return {
          status: "MATCHED" as const,
          matched: true,
          resumed: true,
          chat: {
            id: activeChat.id,
            user1Id: activeChat.user1Id,
            user2Id: activeChat.user2Id,
            otherUser,
          },
        };
      }

      await tx.user.update({
        where: { id: userId },
        data: { status: "ONLINE", lastActiveAt: new Date() },
      });
    }

    await tx.user.update({
      where: {
        id: userId,
      },
      data: {
        // A user who is already waiting must retry the match too. Returning
        // early here left two waiting users stranded when a socket event or
        // their first request was missed.
        status: "GETTING_BORED",
        lastActiveAt: new Date(),
      },
    });

    const otherUser = await tx.user.findFirst({
      where: {
        status: "GETTING_BORED",
        id: {
          not: userId,
        },
        lastActiveAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
      orderBy: {
        lastActiveAt: "asc",
      },
    });

    if (!otherUser) {
      return {
        status: "WAITING" as const,
        matched: false,
      };
    }

    // Claim the candidate atomically. Two join requests can otherwise pick
    // the same waiting user and create duplicate chats.
    const claimedOtherUser = await tx.user.updateMany({
      where: {
        id: otherUser.id,
        status: "GETTING_BORED",
      },
      data: {
        status: "IN_CHAT",
        lastActiveAt: new Date(),
      },
    });

    if (claimedOtherUser.count !== 1) {
      return {
        status: "WAITING" as const,
        matched: false,
      };
    }

    const claimedCurrentUser = await tx.user.updateMany({
      where: {
        id: userId,
        status: "GETTING_BORED",
      },
      data: {
        status: "IN_CHAT",
        lastActiveAt: new Date(),
      },
    });

    if (claimedCurrentUser.count !== 1) {
      // The current user was matched by a concurrent request. Put the
      // candidate back into the queue and let that chat win.
      await tx.user.updateMany({
        where: {
          id: otherUser.id,
          status: "IN_CHAT",
        },
        data: {
          status: "GETTING_BORED",
          lastActiveAt: new Date(),
        },
      });

      return {
        status: "WAITING" as const,
        matched: false,
      };
    }

    const chat = await tx.chat.create({
      data: {
        user1Id: userId,
        user2Id: otherUser.id,
      },
    });

    return {
      status: "MATCHED" as const,
      matched: true,
      chat: {
        id: chat.id,
        user1Id: userId,
        user2Id: otherUser.id,
        otherUser: {
          id: otherUser.id,
          anonymousUsername: otherUser.anonymousUsername,
        },
      },
    };
  });

  // IMPORTANT:
  // The database transaction has completed successfully.
  // Now notify both users through Socket.IO.
  if (result.matched && result.chat && !result.resumed) {
    const {
      id: chatId,
      user1Id,
      user2Id,
    } = result.chat;

    notifyMatch(user1Id, {
      chatId,
    });

    notifyMatch(user2Id, {
      chatId,
    });
  }

  return result;
}


export async function leaveChat(userId: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.status !== "IN_CHAT") {
      return {
        success: true,
        message: "You are not currently in a chat.",
        otherUserId: undefined,
      };
    }

    const chat = await tx.chat.findFirst({
      where: {
        OR: [
          {
            user1Id: userId,
          },
          {
            user2Id: userId,
          },
        ],
        endedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!chat) {
      // Safety: user says IN_CHAT but there is no active chat
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          status: "ONLINE",
          lastActiveAt: new Date(),
        },
      });

      return {
        success: true,
        message: "No active chat found. User returned to online.",
        otherUserId: undefined,
      };
    }

    const otherUserId =
      chat.user1Id === userId
        ? chat.user2Id
        : chat.user1Id;

    // End the chat
    await tx.chat.update({
      where: {
        id: chat.id,
      },
      data: {
        endedAt: new Date(),
      },
    });

    // Return both users to ONLINE
    await tx.user.updateMany({
      where: {
        id: {
          in: [userId, otherUserId],
        },
      },
      data: {
        status: "ONLINE",
        lastActiveAt: new Date(),
      },
    });

    return {
      success: true,
      message: "Chat ended successfully",
      chatId: chat.id,
      otherUserId,
    };
  });
}
export async function stopLooking(
  userId: string
) {
  const user =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

  if (!user) {
    throw new Error(
      "USER_NOT_FOUND"
    );
  }

  if (
    user.status !==
    "GETTING_BORED"
  ) {
    return {
      success: true,
      message:
        "User was not looking for a chat.",
    };
  }

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      status: "ONLINE",
      lastActiveAt: new Date(),
    },
  });

  return {
    success: true,
    message:
      "Stopped looking for someone.",
  };
}

export async function sendPaperPlane(senderId: string, message: string) {
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
      select: { id: true, anonymousUsername: true },
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
        sender: { select: { id: true, anonymousUsername: true } },
      },
    });

    const wallet = await tx.paisaWallet.findUniqueOrThrow({ where: { userId: senderId }, select: { balance: true } });
    return { invite, recipient, balance: wallet.balance };
  });
}

export async function sendCharterPaperPlane(senderId: string, recipientId: string) {
  if (senderId === recipientId) throw new Error("INVALID_CHARTER_RECIPIENT");
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
      select: { id: true, anonymousUsername: true },
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
        message: "A Charter Plane was sent directly to your desk.",
        isCharter: true,
        expiresAt,
      },
      include: { sender: { select: { id: true, anonymousUsername: true } } },
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
  return prisma.paperPlaneInvite.findMany({
    where: { recipientId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      sender: { select: { id: true, anonymousUsername: true } },
    },
  });
}

export async function respondToPaperPlane(recipientId: string, inviteId: string, accept: boolean) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const invite = await tx.paperPlaneInvite.findUnique({
      where: { id: inviteId },
      include: {
        sender: { select: { id: true, anonymousUsername: true, status: true } },
        recipient: { select: { id: true, anonymousUsername: true, status: true } },
      },
    });

    if (!invite || invite.recipientId !== recipientId) throw new Error("PAPER_PLANE_NOT_FOUND");
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

    // Accepting a Plane is the mutual-connection action.  It creates (or
    // reactivates) exactly one private Inbox conversation instead of a
    // temporary stranger chat.
    let connection = await tx.workCircleConnection.findFirst({ where: { OR: [{ requesterId: invite.senderId, recipientId }, { requesterId: recipientId, recipientId: invite.senderId }] } });
    if (!connection) {
      connection = await tx.workCircleConnection.create({ data: { requesterId: invite.senderId, recipientId, requestType: "PLANE", status: "ACCEPTED", respondedAt: now } });
    } else if (connection.status !== "ACCEPTED") {
      // A crushed/deleted direct chat can still hold this nullable-but-unique
      // connectionId. Release that historical reference before reactivating
      // the connection for a newly accepted Paper Plane.
      await tx.chat.updateMany({ where: { connectionId: connection.id, endedAt: { not: null } }, data: { connectionId: null } });
      connection = await tx.workCircleConnection.update({ where: { id: connection.id }, data: { requesterId: invite.senderId, recipientId, requestType: "PLANE", status: "ACCEPTED", respondedAt: now } });
    }

    let chat = await tx.chat.findFirst({ where: { isDirect: true, endedAt: null, OR: [{ connectionId: connection.id }, { user1Id: invite.senderId, user2Id: recipientId }, { user1Id: recipientId, user2Id: invite.senderId }] }, orderBy: { lastMessageAt: "desc" } });
    // A previous Work Circle/chat can have an older connectionId. Always
    // attach the active accepted Plane connection so the chat is visible in
    // Inbox and Socket.IO permits both users to message each other.
    if (chat && chat.connectionId !== connection.id) chat = await tx.chat.update({ where: { id: chat.id }, data: { connectionId: connection.id, lastMessageAt: chat.lastMessageAt ?? now } });
    if (!chat) chat = await tx.chat.create({ data: { user1Id: invite.senderId, user2Id: recipientId, isDirect: true, connectionId: connection.id, lastMessageAt: now } });

    return { accepted: true, chatId: chat.id, senderId: invite.senderId };
  });
}

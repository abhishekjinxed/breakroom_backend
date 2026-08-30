import { prisma } from "../lib/prisma";
import { notifyMatch } from "../socket";

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

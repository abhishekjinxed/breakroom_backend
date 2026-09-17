import { prisma } from "../lib/prisma";
import { disabledTargetIds, moderatorRemovalText } from "./moderation.service";

export async function sendMessage(
  userId: string,
  chatId: string,
  text: string
) {
  const messageText = text.trim();

  if (!messageText) {
    throw new Error("EMPTY_MESSAGE");
  }

  if (messageText.length > 2000) {
    throw new Error("MESSAGE_TOO_LONG");
  }

  // Check that the user belongs to this chat
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      endedAt: null,
      OR: [
        {
          user1Id: userId,
        },
        {
          user2Id: userId,
        },
      ],
    },
  });

  if (!chat) {
    throw new Error("CHAT_NOT_FOUND");
  }

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: userId,
      text: messageText,
    },
  });
  await prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });

  return { message, recipientId: chat.user1Id === userId ? chat.user2Id : chat.user1Id };
}

export async function getChatMessages(
  userId: string,
  chatId: string
) {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      OR: [
        {
          user1Id: userId,
        },
        {
          user2Id: userId,
        },
      ],
    },
  });

  if (!chat) {
    throw new Error("CHAT_NOT_FOUND");
  }

  const disabledMessages = await disabledTargetIds("MESSAGE");
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      senderId: true,
      text: true,
      createdAt: true,
    },
  });

  return messages.map((message) => disabledMessages.includes(message.id) ? { ...message, text: moderatorRemovalText(), isUnavailable: true } : { ...message, isUnavailable: false });
}

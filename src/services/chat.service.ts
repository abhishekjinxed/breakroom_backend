import { prisma } from "../lib/prisma";

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

  if (chat.isDirect) {
    const friendship = await prisma.workCircleConnection.findFirst({ where: { status: "ACCEPTED", OR: [{ id: chat.connectionId ?? undefined }, { requesterId: chat.user1Id, recipientId: chat.user2Id }, { requesterId: chat.user2Id, recipientId: chat.user1Id }] } });
    if (!friendship) throw new Error("CHAT_NOT_FOUND");
  }

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: userId,
      text: messageText,
    },
  });
  await prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });

  return message;
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

  const messages = await prisma.message.findMany({
    where: {
      chatId,
    },
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

  return messages;
}

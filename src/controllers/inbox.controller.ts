import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { notifyChatLeft, notifyInboxUpdated } from "../socket";
import { z } from "zod";
import { createAppNotification } from "../services/notification.service";
import { disabledTargetIds, moderatorRemovalText } from "../services/moderation.service";
import { FriendshipLevel, ConversationPromptStatus } from "@prisma/client";

const member = { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } as const;

const nextLevel: Record<FriendshipLevel, FriendshipLevel | null> = {
  STRANGER: "ACQUAINTANCE",
  ACQUAINTANCE: "FRIEND",
  FRIEND: "CLOSE_FRIEND",
  CLOSE_FRIEND: null,
};

const levelLabel: Record<FriendshipLevel, string> = {
  STRANGER: "Stranger",
  ACQUAINTANCE: "Acquaintance",
  FRIEND: "Friend",
  CLOSE_FRIEND: "Close Friend",
};

const promptDeck: Record<Exclude<FriendshipLevel, "STRANGER">, string[]> = {
  ACQUAINTANCE: [
    "What is one small thing that makes a workday better?",
    "What kind of break helps you reset when the day gets busy?",
    "What is something you enjoy outside work that people would not guess?",
  ],
  FRIEND: [
    "What is a goal you would genuinely like to make time for this year?",
    "What is a lesson you learned from a difficult workday?",
    "What is one thing you value in a good friendship?",
  ],
  CLOSE_FRIEND: [
    "What is something you are quietly proud of?",
    "When life feels noisy, what helps you feel like yourself again?",
    "What is a kindness someone showed you that you still remember?",
  ],
};

const requiredMessages: Record<FriendshipLevel, number> = {
  STRANGER: 0,
  ACQUAINTANCE: 8,
  FRIEND: 30,
  CLOSE_FRIEND: 75,
};

function promptFor(level: Exclude<FriendshipLevel, "STRANGER">, seed: string) {
  const deck = promptDeck[level];
  const index = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % deck.length;
  return deck[index];
}

function serializePrompt(prompt: any, chat: any, userId: string) {
  const ownAnswer = chat.user1Id === userId ? prompt.user1Answer : prompt.user2Answer;
  const memberAnswer = chat.user1Id === userId ? prompt.user2Answer : prompt.user1Answer;
  const bothAnswered = !!prompt.user1Answer && !!prompt.user2Answer;
  return {
    id: prompt.id,
    question: prompt.question,
    targetLevel: prompt.targetLevel,
    targetLabel: levelLabel[prompt.targetLevel as FriendshipLevel],
    status: prompt.status,
    waitingForConsent: prompt.status === "OFFERED",
    myAnswer: bothAnswered ? ownAnswer : null,
    memberAnswer: bothAnswered ? memberAnswer : null,
    hasAnswered: !!ownAnswer,
    memberHasAnswered: !!memberAnswer,
  };
}

async function connectionFor(chat: any, userId: string) {
  const [messageCount, activePrompt, latestPrompt] = await Promise.all([
    prisma.message.count({ where: { chatId: chat.id } }),
    prisma.conversationPrompt.findFirst({ where: { chatId: chat.id, status: { in: ["OFFERED", "ACTIVE"] } }, orderBy: { createdAt: "desc" } }),
    prisma.conversationPrompt.findFirst({ where: { chatId: chat.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const next = nextLevel[chat.friendshipLevel as FriendshipLevel];
  const requestPending = !!chat.levelRequest;
  return {
    level: chat.friendshipLevel,
    levelLabel: levelLabel[chat.friendshipLevel as FriendshipLevel],
    nextLevel: next,
    nextLevelLabel: next ? levelLabel[next] : null,
    messageCount,
    canRequestLevel: !!next && !requestPending && messageCount >= requiredMessages[next],
    pendingLevel: chat.levelRequest,
    requestedByMe: chat.levelRequestedById === userId,
    canAcceptLevel: !!chat.levelRequest && chat.levelRequestedById !== userId,
    canOfferPrompt: !!next && !requestPending && !activePrompt && messageCount >= Math.max(6, requiredMessages[next] - 2),
    prompt: latestPrompt ? serializePrompt(latestPrompt, chat, userId) : null,
  };
}

async function ensureAcceptedPlaneChats(userId: string) {
  const acceptedPlanes = await prisma.paperPlaneInvite.findMany({
    // Only reconcile recent accepts. Historical accepted planes may belong to
    // conversations deliberately crushed or deleted by a participant.
    where: { status: "ACCEPTED", respondedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, OR: [{ senderId: userId }, { recipientId: userId }] },
    select: { senderId: true, recipientId: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const plane of acceptedPlanes) {
      const anyDirectChat = await tx.chat.findFirst({ where: { isDirect: true, OR: [{ user1Id: plane.senderId, user2Id: plane.recipientId }, { user1Id: plane.recipientId, user2Id: plane.senderId }] }, orderBy: { createdAt: "desc" } });
      // Never recreate a direct chat that has been explicitly ended.
      if (anyDirectChat?.endedAt) continue;
      const existingChat = anyDirectChat;
      if (!existingChat) {
        await tx.chat.create({ data: { user1Id: plane.senderId, user2Id: plane.recipientId, isDirect: true, lastMessageAt: new Date() } });
      }
    }
  });
}

export async function listInbox(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  // Reconcile only a fresh acceptance that was interrupted between its Plane
  // response and direct-chat creation.
  await ensureAcceptedPlaneChats(userId);
  const chats = await prisma.chat.findMany({
    where: { isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: { user1: { select: member }, user2: { select: member }, messages: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } } },
  });
  // One person, one active Inbox thread. Older duplicates can exist from
  // earlier app versions; show only the most recently active one.
  const newestByMember = new Map<string, typeof chats[number]>();
  for (const chat of chats) {
    const memberId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
    const current = newestByMember.get(memberId);
    const chatTime = (chat.lastMessageAt ?? chat.createdAt).getTime();
    const currentTime = current ? (current.lastMessageAt ?? current.createdAt).getTime() : -1;
    if (!current || chatTime > currentTime) newestByMember.set(memberId, chat);
  }
  const disabledMessages = new Set(await disabledTargetIds("MESSAGE"));
  const conversations = Array.from(newestByMember.values()).sort((a, b) => (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime()).map((chat) => ({ id: chat.id, member: chat.user1Id === userId ? chat.user2 : chat.user1, latestMessage: chat.messages[0] ? { text: disabledMessages.has(chat.messages[0].id) ? moderatorRemovalText() : chat.messages[0].text, createdAt: chat.messages[0].createdAt } : null, unreadCount: chat._count.messages, updatedAt: chat.lastMessageAt ?? chat.createdAt }));
  return res.json({ success: true, conversations });
}

export async function readConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const chat = await prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] }, include: { user1: { select: member }, user2: { select: member } } });
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  await prisma.message.updateMany({ where: { chatId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
  const disabledMessages = await disabledTargetIds("MESSAGE");
  const messages = await prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "asc" }, select: { id: true, chatId: true, senderId: true, text: true, createdAt: true, readAt: true } });
  const disabledMessageSet = new Set(disabledMessages);
  const isSharingMyProfile = chat.user1Id === userId ? chat.profileSharedByUser1 : chat.profileSharedByUser2;
  const memberSharedAProfile = chat.user1Id === userId ? chat.profileSharedByUser2 : chat.profileSharedByUser1;
  const hasSharedMemberPhoto = await prisma.profilePhotoShare.findFirst({ where: { recipientId: userId, photo: { ownerId: otherUserId } }, select: { photoId: true } });
  const canViewMemberProfile = memberSharedAProfile || !!hasSharedMemberPhoto;
  const myPhotos = await prisma.profilePhoto.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" }, select: { id: true, url: true, visibility: true, createdAt: true, shares: { where: { recipientId: otherUserId }, select: { recipientId: true } } } });
  const otherMember = chat.user1Id === userId ? chat.user2 : chat.user1;
  const connection = await connectionFor(chat, userId);
  return res.json({ success: true, messages: messages.map((message) => disabledMessageSet.has(message.id) ? { ...message, text: moderatorRemovalText(), isUnavailable: true } : { ...message, isUnavailable: false }), otherMember, profileSharing: { isSharingMyProfile, canViewMemberProfile, memberId: canViewMemberProfile ? otherUserId : null, photos: myPhotos.map(({ shares, ...photo }) => ({ ...photo, sharedWithMember: shares.length > 0 })) }, connection });
}

async function findDirectChat(userId: string, chatId: string) {
  return prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] } });
}

const levelActionSchema = z.object({ action: z.enum(["REQUEST", "ACCEPT"]) });

export async function updateFriendshipLevel(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const parsed = levelActionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose a valid connection action." });
  const chat = await findDirectChat(userId, chatId);
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const next = nextLevel[chat.friendshipLevel];
  if (!next) return res.status(400).json({ success: false, message: "This friendship is already at its highest level." });
  const messageCount = await prisma.message.count({ where: { chatId } });
  if (messageCount < requiredMessages[next]) return res.status(400).json({ success: false, message: "Keep chatting a little longer before taking the next friendship step." });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  if (parsed.data.action === "REQUEST") {
    if (chat.levelRequest) return res.status(409).json({ success: false, message: "A friendship step is already waiting for a response." });
    await prisma.chat.update({ where: { id: chat.id }, data: { levelRequest: next, levelRequestedById: userId } });
    await createAppNotification({ userId: otherUserId, type: "CONNECTION_UPDATE", title: "Friendship step", detail: `Your chat partner would like to become ${levelLabel[next]}s.`, link: `/chat/${chat.id}` });
  } else {
    if (!chat.levelRequest || chat.levelRequestedById === userId) return res.status(400).json({ success: false, message: "There is no friendship step to accept." });
    await prisma.chat.update({ where: { id: chat.id }, data: { friendshipLevel: chat.levelRequest, levelRequest: null, levelRequestedById: null } });
    await createAppNotification({ userId: otherUserId, type: "CONNECTION_UPDATE", title: "Friendship updated", detail: `You are now ${levelLabel[chat.levelRequest]}s in Breakroom.`, link: `/chat/${chat.id}` });
  }
  notifyInboxUpdated(otherUserId, { chatId: chat.id });
  return res.json({ success: true, connection: await connectionFor(await findDirectChat(userId, chat.id), userId) });
}

export async function offerConversationPrompt(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const chat = await findDirectChat(userId, chatId);
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const connection = await connectionFor(chat, userId);
  if (!connection.canOfferPrompt || !connection.nextLevel) return res.status(400).json({ success: false, message: "A shared question is not ready right now." });
  const targetLevel = connection.nextLevel as Exclude<FriendshipLevel, "STRANGER">;
  const created = await prisma.conversationPrompt.create({ data: { chatId: chat.id, question: promptFor(targetLevel, `${chat.id}-${Date.now()}`), targetLevel, proposerId: userId, user1Accepted: chat.user1Id === userId, user2Accepted: chat.user2Id === userId } });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  await createAppNotification({ userId: otherUserId, type: "CONNECTION_UPDATE", title: "A shared question is waiting", detail: "Your chat partner opened an optional get-to-know-you question.", link: `/chat/${chat.id}` });
  notifyInboxUpdated(otherUserId, { chatId: chat.id });
  return res.status(201).json({ success: true, prompt: serializePrompt(created, chat, userId) });
}

const promptActionSchema = z.object({ action: z.enum(["ACCEPT", "DECLINE", "ANSWER"]), answer: z.string().trim().min(1).max(600).optional() });

export async function respondToConversationPrompt(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const promptId = typeof req.params.promptId === "string" ? req.params.promptId : "";
  const parsed = promptActionSchema.safeParse(req.body);
  if (!parsed.success || (parsed.data.action === "ANSWER" && !parsed.data.answer)) return res.status(400).json({ success: false, message: "Write a short answer before sharing." });
  const chat = await findDirectChat(userId, chatId);
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const prompt = await prisma.conversationPrompt.findFirst({ where: { id: promptId, chatId } });
  if (!prompt || !["OFFERED", "ACTIVE"].includes(prompt.status)) return res.status(404).json({ success: false, message: "That shared question is no longer available." });
  const isUser1 = chat.user1Id === userId;
  let data: any = {};
  if (parsed.data.action === "DECLINE") data = { status: "DECLINED" as ConversationPromptStatus };
  if (parsed.data.action === "ACCEPT") {
    const accepts = isUser1 ? { user1Accepted: true } : { user2Accepted: true };
    const bothAccepted = (isUser1 ? true : prompt.user1Accepted) && (isUser1 ? prompt.user2Accepted : true);
    data = { ...accepts, ...(bothAccepted ? { status: "ACTIVE" as ConversationPromptStatus } : {}) };
  }
  if (parsed.data.action === "ANSWER") {
    if (prompt.status !== "ACTIVE") return res.status(400).json({ success: false, message: "Both people need to opt in before answering." });
    const answers = isUser1 ? { user1Answer: parsed.data.answer } : { user2Answer: parsed.data.answer };
    const bothAnswered = isUser1 ? !!prompt.user2Answer : !!prompt.user1Answer;
    data = { ...answers, ...(bothAnswered ? { status: "COMPLETED" as ConversationPromptStatus, completedAt: new Date() } : {}) };
  }
  const updated = await prisma.conversationPrompt.update({ where: { id: prompt.id }, data });
  const otherUserId = isUser1 ? chat.user2Id : chat.user1Id;
  notifyInboxUpdated(otherUserId, { chatId: chat.id });
  return res.json({ success: true, prompt: serializePrompt(updated, chat, userId) });
}

const profileSharingSchema = z.object({ share: z.boolean() });
const chatPhotoSharingSchema = z.object({ share: z.boolean() });

export async function updateProfileSharing(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const parsed = profileSharingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose whether to share your profile." });

  const chat = await prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] } });
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  const updated = await prisma.chat.update({ where: { id: chat.id }, data: chat.user1Id === userId ? { profileSharedByUser1: parsed.data.share } : { profileSharedByUser2: parsed.data.share } });
  notifyInboxUpdated(otherUserId, { chatId: chat.id });
  return res.json({ success: true, isSharingMyProfile: chat.user1Id === userId ? updated.profileSharedByUser1 : updated.profileSharedByUser2 });
}

export async function updateChatPhotoSharing(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const photoId = typeof req.params.photoId === "string" ? req.params.photoId : "";
  const parsed = chatPhotoSharingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose whether to share this photo." });
  const chat = await prisma.chat.findFirst({ where: { id: chatId, isDirect: true, endedAt: null, OR: [{ user1Id: userId }, { user2Id: userId }] } });
  if (!chat) return res.status(404).json({ success: false, message: "Conversation not found." });
  const otherUserId = chat.user1Id === userId ? chat.user2Id : chat.user1Id;
  const photo = await prisma.profilePhoto.findFirst({ where: { id: photoId, ownerId: userId }, select: { id: true } });
  if (!photo) return res.status(404).json({ success: false, message: "Profile photo not found." });
  if (parsed.data.share) await prisma.profilePhotoShare.upsert({ where: { photoId_recipientId: { photoId: photo.id, recipientId: otherUserId } }, create: { photoId: photo.id, recipientId: otherUserId }, update: {} });
  else await prisma.profilePhotoShare.deleteMany({ where: { photoId: photo.id, recipientId: otherUserId } });
  notifyInboxUpdated(otherUserId, { chatId: chat.id });
  return res.json({ success: true, shared: parsed.data.share });
}

export async function deleteConversation(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!; const chatId = typeof req.params.id === "string" ? req.params.id : "";
  const result = await prisma.$transaction(async (tx) => {
    const chat = await tx.chat.findFirst({ where: { id: chatId, isDirect: true, OR: [{ user1Id: userId }, { user2Id: userId }] } });
    if (!chat) return { removed: false, otherUserId: null };
    if (chat.endedAt) return { removed: true, otherUserId: chat.user1Id === userId ? chat.user2Id : chat.user1Id };
    const now = new Date();
    await tx.chat.update({ where: { id: chat.id }, data: { endedAt: now } });
    return { removed: true, otherUserId: chat.user1Id === userId ? chat.user2Id : chat.user1Id };
  });
  if (result.removed && result.otherUserId) {
    notifyChatLeft(result.otherUserId, { chatId });
    await createAppNotification({ userId: result.otherUserId, type: "CONVERSATION_ENDED", title: "Conversation removed", detail: "The other member ended this private conversation.", link: "/inbox" });
  }
  return res.json({ success: true, removed: result.removed });
}

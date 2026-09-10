import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const ROOM_DURATION_MS = 5 * 60 * 1000;
const WAITING_ROOM_TTL_MS = 10 * 60 * 1000;
const ENDED_ROOM_SUMMARY_MS = 60 * 60 * 1000;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 5;

const prompts = [
  "What is one small win from your day so far?",
  "What is making work lighter this week?",
  "What is one thing you would happily take off your to-do list?",
  "What is a small habit that helps you reset between meetings?",
  "What is one thing you are looking forward to after work?",
];

const member = { id: true, anonymousUsername: true } as const;
const roomInclude = {
  participants: { orderBy: { joinedAt: "asc" as const }, include: { user: { select: member } } },
  messages: { orderBy: { createdAt: "asc" as const }, include: { sender: { select: member } } },
};

function roomPayload(room: any, userId: string) {
  const now = Date.now();
  const active = room.status === "ACTIVE" && room.endsAt && new Date(room.endsAt).getTime() > now;
  const ended = room.status === "ENDED";
  return {
    id: room.id,
    status: room.status,
    prompt: room.prompt,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    endedAt: room.endedAt,
    minParticipants: MIN_PARTICIPANTS,
    maxParticipants: MAX_PARTICIPANTS,
    canChat: active && room.participants.some((participant: any) => participant.userId === userId && !participant.leftAt),
    participants: room.participants.map((participant: any) => ({
      id: participant.user.id,
      anonymousUsername: participant.user.anonymousUsername,
      joinedAt: participant.joinedAt,
      hasLeft: !!participant.leftAt,
    })),
    // A Coffee Break is intentionally ephemeral. An ended-room response does
    // not expose earlier conversation content.
    messages: ended ? [] : room.messages.map((message: any) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      sender: message.sender,
    })),
  };
}

async function tidyRooms() {
  const now = new Date();
  const expired = await prisma.coffeeBreakRoom.findMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    select: { id: true },
  });
  if (expired.length) {
    const ids = expired.map((room) => room.id);
    await prisma.$transaction([
      prisma.coffeeBreakRoom.updateMany({ where: { id: { in: ids }, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } }),
      prisma.coffeeBreakMessage.deleteMany({ where: { roomId: { in: ids } } }),
    ]);
  }
  await prisma.coffeeBreakRoom.updateMany({
    where: { status: "WAITING", createdAt: { lte: new Date(now.getTime() - WAITING_ROOM_TTL_MS) } },
    data: { status: "CANCELLED", endedAt: now },
  });
}

async function readRoom(roomId: string, userId: string) {
  const room = await prisma.coffeeBreakRoom.findFirst({
    where: { id: roomId, participants: { some: { userId } } },
    include: roomInclude,
  });
  return room ? roomPayload(room, userId) : null;
}

async function isBlockedWith(userId: string, memberIds: string[]) {
  if (!memberIds.length) return false;
  return !!(await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: memberIds } },
        { blockerId: { in: memberIds }, blockedId: userId },
      ],
    },
    select: { blockerId: true },
  }));
}

export async function availability(_req: AuthenticatedRequest, res: Response) {
  await tidyRooms();
  const waiting = await prisma.coffeeBreakParticipant.count({ where: { leftAt: null, room: { status: "WAITING" } } });
  return res.json({ success: true, waiting, neededToStart: Math.max(0, MIN_PARTICIPANTS - waiting) });
}

export async function currentCoffeeBreak(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyRooms();
  const now = new Date();
  const activeMembership = await prisma.coffeeBreakParticipant.findFirst({
    where: { userId: req.userId, leftAt: null, room: { status: { in: ["WAITING", "ACTIVE"] } } },
    orderBy: { joinedAt: "desc" },
    select: { roomId: true },
  });
  if (activeMembership) return res.json({ success: true, room: await readRoom(activeMembership.roomId, req.userId) });

  const recentEnded = await prisma.coffeeBreakParticipant.findFirst({
    where: { userId: req.userId, room: { status: "ENDED", endedAt: { gte: new Date(now.getTime() - ENDED_ROOM_SUMMARY_MS) } } },
    orderBy: { joinedAt: "desc" },
    select: { roomId: true },
  });
  return res.json({ success: true, room: recentEnded ? await readRoom(recentEnded.roomId, req.userId) : null });
}

export async function joinCoffeeBreak(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyRooms();
  const userId = req.userId;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.coffeeBreakParticipant.findFirst({
      where: { userId, leftAt: null, room: { status: { in: ["WAITING", "ACTIVE"] } } },
      orderBy: { joinedAt: "desc" },
      select: { roomId: true },
    });
    if (current) return { roomId: current.roomId, alreadyJoined: true };

    const waitingRooms = await tx.coffeeBreakRoom.findMany({
      // A room becomes live at three people but stays open until it reaches
      // five, so a late arrival can still join a small active break.
      where: { OR: [{ status: "WAITING" }, { status: "ACTIVE", endsAt: { gt: new Date() } }] },
      orderBy: { createdAt: "asc" },
      include: { participants: { where: { leftAt: null }, select: { userId: true } } },
      take: 12,
    });
    let selected = null as (typeof waitingRooms)[number] | null;
    for (const room of waitingRooms) {
      if (room.participants.length >= MAX_PARTICIPANTS) continue;
      if (!(await isBlockedWith(userId, room.participants.map((participant) => participant.userId)))) {
        selected = room;
        break;
      }
    }

    if (!selected) {
      const room = await tx.coffeeBreakRoom.create({
        data: { prompt: prompts[Math.floor(Math.random() * prompts.length)], participants: { create: { userId } } },
      });
      return { roomId: room.id, alreadyJoined: false };
    }

    await tx.coffeeBreakParticipant.create({ data: { roomId: selected.id, userId } });
    const participantCount = selected.participants.length + 1;
    if (selected.status === "WAITING" && participantCount >= MIN_PARTICIPANTS) {
      const startedAt = new Date();
      await tx.coffeeBreakRoom.updateMany({
        where: { id: selected.id, status: "WAITING" },
        data: { status: "ACTIVE", startedAt, endsAt: new Date(startedAt.getTime() + ROOM_DURATION_MS) },
      });
    }
    return { roomId: selected.id, alreadyJoined: false };
  });
  return res.status(result.alreadyJoined ? 200 : 201).json({ success: true, room: await readRoom(result.roomId, userId) });
}

export async function leaveCoffeeBreak(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const membership = await prisma.coffeeBreakParticipant.findFirst({
    where: { userId: req.userId, leftAt: null, room: { status: { in: ["WAITING", "ACTIVE"] } } },
    orderBy: { joinedAt: "desc" },
    select: { roomId: true },
  });
  if (!membership) return res.json({ success: true });
  const now = new Date();
  await prisma.coffeeBreakParticipant.update({ where: { roomId_userId: { roomId: membership.roomId, userId: req.userId } }, data: { leftAt: now } });
  const remaining = await prisma.coffeeBreakParticipant.count({ where: { roomId: membership.roomId, leftAt: null } });
  if (!remaining) {
    // An empty room must not remain joinable for the rest of its five-minute
    // window. Close it immediately and clear its temporary chat so the next
    // member begins a completely fresh Coffee Break Room.
    await prisma.$transaction([
      prisma.coffeeBreakRoom.updateMany({ where: { id: membership.roomId, status: { in: ["WAITING", "ACTIVE"] } }, data: { status: "CANCELLED", endedAt: now } }),
      prisma.coffeeBreakMessage.deleteMany({ where: { roomId: membership.roomId } }),
    ]);
  }
  return res.json({ success: true });
}

const messageSchema = z.object({ text: z.string().trim().min(1).max(500) });

export async function sendCoffeeBreakMessage(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.roomId !== "string") return res.status(400).json({ success: false, message: "Invalid Coffee Break room." });
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a message up to 500 characters." });
  await tidyRooms();
  const room = await prisma.coffeeBreakRoom.findFirst({
    where: { id: req.params.roomId, status: "ACTIVE", endsAt: { gt: new Date() }, participants: { some: { userId: req.userId, leftAt: null } } },
    select: { id: true },
  });
  if (!room) return res.status(409).json({ success: false, message: "This Coffee Break has ended or you have left it." });
  const message = await prisma.coffeeBreakMessage.create({ data: { roomId: room.id, senderId: req.userId, text: parsed.data.text }, include: { sender: { select: member } } });
  return res.status(201).json({ success: true, message });
}

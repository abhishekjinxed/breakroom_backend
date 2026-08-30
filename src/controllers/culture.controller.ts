import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const INTERESTS = ["Technology", "Design", "Startups", "Fitness", "Gaming", "Books", "Finance", "Sports", "Music", "Food"];
const prompts = ["What made your workday easier today?", "What is one small win worth celebrating today?", "What are you taking a break from right now?", "What is one thing you learned this week?"];
const challenges = ["Describe your ideal five-minute break in one line.", "Share your best harmless desk-life hack.", "What would your team’s unofficial motto be?"];
const dayStart = () => { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
const dayKey = () => dayStart().toISOString().slice(0, 10);
const indexForToday = (items: string[]) => Math.floor(dayStart().getTime() / 86400000) % items.length;
const member = { id: true, anonymousUsername: true } as const;

export async function overview(req: AuthenticatedRequest, res: Response) {
  const userId = req.userId!;
  const date = dayStart(); const challengeKey = dayKey();
  const [myPrompt, promptResponses, kudos, challengeResponses, interests, queued] = await Promise.all([
    prisma.dailyDeskResponse.findUnique({ where: { userId_promptDate: { userId, promptDate: date } }, select: { text: true } }),
    prisma.dailyDeskResponse.findMany({ where: { promptDate: date }, orderBy: { createdAt: "desc" }, take: 12, include: { user: { select: member } } }),
    prisma.kudos.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { sender: { select: member }, recipient: { select: member } } }),
    prisma.cultureChallengeResponse.findMany({ where: { challengeKey }, orderBy: { createdAt: "desc" }, take: 15, include: { user: { select: member } } }),
    prisma.userInterest.findMany({ where: { userId }, select: { interest: true } }),
    prisma.coffeeQueue.findUnique({ where: { userId }, select: { topic: true } }),
  ]);
  return res.json({ success: true, interests: INTERESTS, myInterests: interests.map((item) => item.interest), coffeeTopic: queued?.topic ?? null, prompt: { date: challengeKey, text: prompts[indexForToday(prompts)], mine: myPrompt?.text ?? null, responses: promptResponses.map((item) => ({ id: item.id, text: item.text, author: item.user })) }, challenge: { key: challengeKey, text: challenges[indexForToday(challenges)], responses: challengeResponses.map((item) => ({ id: item.id, text: item.text, author: item.user })) }, kudos: kudos.map((item) => ({ id: item.id, message: item.message, createdAt: item.createdAt, sender: item.sender, recipient: item.recipient })) });
}

export async function answerPrompt(req: AuthenticatedRequest, res: Response) {
  const parsed = z.object({ text: z.string().trim().min(1).max(240) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Keep your response under 240 characters." });
  const response = await prisma.dailyDeskResponse.upsert({ where: { userId_promptDate: { userId: req.userId!, promptDate: dayStart() } }, create: { userId: req.userId!, promptDate: dayStart(), text: parsed.data.text }, update: { text: parsed.data.text }, include: { user: { select: member } } });
  return res.json({ success: true, response: { id: response.id, text: response.text, author: response.user } });
}

export async function answerChallenge(req: AuthenticatedRequest, res: Response) {
  const parsed = z.object({ text: z.string().trim().min(1).max(160) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Keep your challenge response under 160 characters." });
  const response = await prisma.cultureChallengeResponse.upsert({ where: { userId_challengeKey: { userId: req.userId!, challengeKey: dayKey() } }, create: { userId: req.userId!, challengeKey: dayKey(), text: parsed.data.text }, update: { text: parsed.data.text }, include: { user: { select: member } } });
  return res.json({ success: true, response: { id: response.id, text: response.text, author: response.user } });
}

export async function updateInterests(req: AuthenticatedRequest, res: Response) {
  const parsed = z.object({ interests: z.array(z.string()).max(5) }).safeParse(req.body);
  if (!parsed.success || parsed.data.interests.some((value) => !INTERESTS.includes(value))) return res.status(400).json({ success: false, message: "Choose up to five available interests." });
  await prisma.$transaction([prisma.userInterest.deleteMany({ where: { userId: req.userId! } }), prisma.userInterest.createMany({ data: [...new Set(parsed.data.interests)].map((interest) => ({ userId: req.userId!, interest })) })]);
  return res.json({ success: true, interests: [...new Set(parsed.data.interests)] });
}

export async function giveKudos(req: AuthenticatedRequest, res: Response) {
  const parsed = z.object({ recipientId: z.string().min(1), message: z.string().trim().min(1).max(240) }).safeParse(req.body);
  if (!parsed.success || parsed.data.recipientId === req.userId) return res.status(400).json({ success: false, message: "Choose another Work Circle member and add a short note." });
  const connection = await prisma.workCircleConnection.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: req.userId!, recipientId: parsed.data.recipientId }, { requesterId: parsed.data.recipientId, recipientId: req.userId! }] } });
  if (!connection) return res.status(403).json({ success: false, message: "Kudos can be sent to your Work Circle only." });
  const kudos = await prisma.kudos.create({ data: { senderId: req.userId!, recipientId: parsed.data.recipientId, message: parsed.data.message }, include: { sender: { select: member }, recipient: { select: member } } });
  return res.status(201).json({ success: true, kudos });
}

export async function joinCoffee(req: AuthenticatedRequest, res: Response) {
  const parsed = z.object({ topic: z.string().trim().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose a coffee topic." });
  const userId = req.userId!;
  const candidate = await prisma.coffeeQueue.findFirst({ where: { userId: { not: userId }, topic: parsed.data.topic, user: { deletedAt: null } }, orderBy: { createdAt: "asc" } });
  if (!candidate) { await prisma.coffeeQueue.upsert({ where: { userId }, create: { userId, topic: parsed.data.topic }, update: { topic: parsed.data.topic, createdAt: new Date() } }); return res.json({ success: true, matched: false, message: "You are in the coffee queue. We will pair you when someone chooses the same topic." }); }
  const claimed = await prisma.coffeeQueue.deleteMany({ where: { userId: candidate.userId, topic: candidate.topic } });
  if (!claimed.count) return joinCoffee(req, res);
  await prisma.coffeeQueue.deleteMany({ where: { userId } });
  const chat = await prisma.chat.create({ data: { user1Id: userId, user2Id: candidate.userId, isDirect: true } });
  return res.json({ success: true, matched: true, chat: { id: chat.id } });
}

export async function leaveCoffee(req: AuthenticatedRequest, res: Response) { await prisma.coffeeQueue.deleteMany({ where: { userId: req.userId! } }); return res.json({ success: true }); }

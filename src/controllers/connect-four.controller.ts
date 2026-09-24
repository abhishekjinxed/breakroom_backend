import { Response } from "express";
import { Prisma, TicTacToeGameStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const WAITING_TTL_MS = 5 * 60 * 1000;
const ACTIVE_TTL_MS = 15 * 60 * 1000;
const playerSelect = { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } as const;
const includePlayers = { playerRed: { select: playerSelect }, playerYellow: { select: playerSelect }, winner: { select: playerSelect } } as const;
type Game = Prisma.ConnectFourGameGetPayload<{ include: typeof includePlayers }>;
const moveSchema = z.object({ column: z.number().int().min(0).max(6) });
const emptyBoard = ".".repeat(42);

async function tidyGames(userId: string) {
  const now = new Date();
  await prisma.connectFourGame.updateMany({ where: { status: "WAITING", createdAt: { lte: new Date(now.getTime() - WAITING_TTL_MS) }, OR: [{ playerRedId: userId }, { playerYellowId: userId }] }, data: { status: "CANCELLED", finishedAt: now, turnUserId: null } });
  await prisma.connectFourGame.updateMany({ where: { status: "ACTIVE", updatedAt: { lte: new Date(now.getTime() - ACTIVE_TTL_MS) }, OR: [{ playerRedId: userId }, { playerYellowId: userId }] }, data: { status: "CANCELLED", finishedAt: now, turnUserId: null } });
}

async function blockedWith(userId: string, otherId: string) {
  return !!(await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] }, select: { blockerId: true } }));
}

function payload(game: Game, userId: string) {
  const isRed = game.playerRedId === userId;
  return {
    id: game.id,
    status: game.status,
    board: game.board,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    color: isRed ? "R" : "Y",
    yourTurn: game.status === "ACTIVE" && game.turnUserId === userId,
    winnerColor: game.winnerUserId ? (game.winnerUserId === game.playerRedId ? "R" : "Y") : null,
    isDraw: game.status === "FINISHED" && !game.winnerUserId,
    opponent: isRed ? game.playerYellow : game.playerRed,
  };
}

async function findCurrent(userId: string) {
  return prisma.connectFourGame.findFirst({ where: { status: { in: ["WAITING", "ACTIVE"] }, OR: [{ playerRedId: userId }, { playerYellowId: userId }] }, orderBy: { createdAt: "desc" }, include: includePlayers });
}

export async function currentConnectFour(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyGames(req.userId);
  const game = await findCurrent(req.userId) ?? await prisma.connectFourGame.findFirst({ where: { status: "FINISHED", finishedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, OR: [{ playerRedId: req.userId }, { playerYellowId: req.userId }] }, orderBy: { finishedAt: "desc" }, include: includePlayers });
  return res.json({ success: true, game: game ? payload(game, req.userId) : null });
}

export async function joinConnectFour(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyGames(req.userId);
  const existing = await findCurrent(req.userId);
  if (existing) return res.json({ success: true, game: payload(existing, req.userId) });

  const candidates = await prisma.connectFourGame.findMany({
    where: { status: "WAITING", createdAt: { gt: new Date(Date.now() - WAITING_TTL_MS) }, playerYellowId: null, playerRedId: { not: req.userId }, playerRed: { deletedAt: null, status: { not: "DEACTIVATED" } } },
    orderBy: { createdAt: "asc" }, select: { id: true, playerRedId: true }, take: 20,
  });
  for (const candidate of candidates) {
    if (await blockedWith(req.userId, candidate.playerRedId)) continue;
    const claimed = await prisma.connectFourGame.updateMany({ where: { id: candidate.id, status: "WAITING", playerYellowId: null }, data: { playerYellowId: req.userId, turnUserId: candidate.playerRedId, status: "ACTIVE" } });
    if (claimed.count) {
      const game = await prisma.connectFourGame.findUniqueOrThrow({ where: { id: candidate.id }, include: includePlayers });
      return res.status(201).json({ success: true, game: payload(game, req.userId) });
    }
  }
  const game = await prisma.connectFourGame.create({ data: { playerRedId: req.userId, board: emptyBoard }, include: includePlayers });
  return res.status(201).json({ success: true, game: payload(game, req.userId) });
}

function winnerAt(board: string[], row: number, col: number, color: string) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === color) { count++; r += dr * sign; c += dc * sign; }
    }
    return count >= 4;
  });
}

export async function moveConnectFour(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.gameId !== "string") return res.status(400).json({ success: false, message: "Invalid game." });
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose a column from 1 to 7." });
  await tidyGames(req.userId);
  const game = await prisma.connectFourGame.findFirst({ where: { id: req.params.gameId, status: "ACTIVE", OR: [{ playerRedId: req.userId }, { playerYellowId: req.userId }] } });
  if (!game) return res.status(409).json({ success: false, message: "This match is no longer available." });
  if (game.turnUserId !== req.userId) return res.status(409).json({ success: false, message: "It is your opponent’s turn." });
  const board = [...game.board];
  let row = -1;
  for (let r = 5; r >= 0; r--) if (board[r * 7 + parsed.data.column] === ".") { row = r; break; }
  if (row < 0) return res.status(409).json({ success: false, message: "That column is full. Choose another." });
  const color = game.playerRedId === req.userId ? "R" : "Y";
  board[row * 7 + parsed.data.column] = color;
  const boardValue = board.join("");
  const won = winnerAt(board, row, parsed.data.column, color);
  const draw = !won && !board.includes(".");
  const now = new Date();
  const updatedCount = await prisma.connectFourGame.updateMany({
    where: { id: game.id, status: "ACTIVE", turnUserId: req.userId, board: game.board },
    data: won || draw ? { board: boardValue, status: "FINISHED", winnerUserId: won ? req.userId : null, turnUserId: null, finishedAt: now } : { board: boardValue, turnUserId: game.playerRedId === req.userId ? game.playerYellowId : game.playerRedId },
  });
  if (!updatedCount.count) return res.status(409).json({ success: false, message: "The board changed. Refresh and try again." });
  const updated = await prisma.connectFourGame.findUniqueOrThrow({ where: { id: game.id }, include: includePlayers });
  return res.json({ success: true, game: payload(updated, req.userId) });
}

export async function leaveConnectFour(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.gameId !== "string") return res.status(400).json({ success: false, message: "Invalid game." });
  const result = await prisma.connectFourGame.updateMany({ where: { id: req.params.gameId, status: { in: [TicTacToeGameStatus.WAITING, TicTacToeGameStatus.ACTIVE] }, OR: [{ playerRedId: req.userId }, { playerYellowId: req.userId }] }, data: { status: "CANCELLED", finishedAt: new Date(), turnUserId: null } });
  return res.json({ success: true, left: result.count > 0 });
}

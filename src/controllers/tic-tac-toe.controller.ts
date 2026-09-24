import { Response } from "express";
import { z } from "zod";
import { Prisma, TicTacToeGameStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const WAITING_TTL_MS = 5 * 60 * 1000;
const ACTIVE_TTL_MS = 10 * 60 * 1000;
const playerSelect = { id: true, anonymousUsername: true, publicAvatarUrl: true, publicFlair: true } as const;
const gameInclude = { playerX: { select: playerSelect }, playerO: { select: playerSelect }, winner: { select: playerSelect } } as const;
type GameWithPlayers = Prisma.TicTacToeGameGetPayload<{ include: typeof gameInclude }>;
const moveSchema = z.object({ cell: z.number().int().min(0).max(8) });

function winnerForBoard(board: string): "X" | "O" | null {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const [a, b, c] of lines) {
    if (board[a] !== "." && board[a] === board[b] && board[a] === board[c]) return board[a] as "X" | "O";
  }
  return null;
}

async function tidyGames(userId: string) {
  const now = new Date();
  await prisma.ticTacToeGame.updateMany({
    where: { status: "WAITING", createdAt: { lte: new Date(now.getTime() - WAITING_TTL_MS) }, OR: [{ playerXId: userId }, { playerOId: userId }] },
    data: { status: "CANCELLED", finishedAt: now },
  });
  await prisma.ticTacToeGame.updateMany({
    where: { status: "ACTIVE", updatedAt: { lte: new Date(now.getTime() - ACTIVE_TTL_MS) }, OR: [{ playerXId: userId }, { playerOId: userId }] },
    data: { status: "CANCELLED", finishedAt: now },
  });
}

async function blockedWith(userId: string, otherId: string) {
  return !!(await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] },
    select: { blockerId: true },
  }));
}

function gamePayload(game: GameWithPlayers, userId: string) {
  const mark = game.playerXId === userId ? "X" : "O";
  const opponent = mark === "X" ? game.playerO : game.playerX;
  const winnerMark = game.winnerUserId ? (game.winnerUserId === game.playerXId ? "X" : "O") : null;
  return {
    id: game.id,
    status: game.status,
    board: game.board,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    mark,
    yourTurn: game.status === "ACTIVE" && game.turnUserId === userId,
    winnerMark,
    isDraw: game.status === "FINISHED" && !game.winnerUserId,
    opponent,
  };
}

async function findCurrentGame(userId: string) {
  return prisma.ticTacToeGame.findFirst({
    where: { status: { in: ["WAITING", "ACTIVE"] }, OR: [{ playerXId: userId }, { playerOId: userId }] },
    orderBy: { createdAt: "desc" },
    include: gameInclude,
  });
}

export async function currentTicTacToe(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyGames(req.userId);
  // Keep the completed board visible to both players briefly. Without this,
  // the opponent who made the last move sees the result while the other
  // player’s polling request would only receive an empty lobby.
  const game = await findCurrentGame(req.userId) ?? await prisma.ticTacToeGame.findFirst({
    where: {
      status: "FINISHED",
      finishedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      OR: [{ playerXId: req.userId }, { playerOId: req.userId }],
    },
    orderBy: { finishedAt: "desc" },
    include: gameInclude,
  });
  return res.json({ success: true, game: game ? gamePayload(game, req.userId) : null });
}

export async function joinTicTacToe(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  await tidyGames(req.userId);
  const existing = await findCurrentGame(req.userId);
  if (existing) return res.json({ success: true, game: gamePayload(existing, req.userId) });

  // A conditional update makes joining a waiting match safe when two people
  // press the button at almost the same time.
  const candidates = await prisma.ticTacToeGame.findMany({
    where: { status: "WAITING", createdAt: { gt: new Date(Date.now() - WAITING_TTL_MS) }, playerOId: null, playerXId: { not: req.userId }, playerX: { deletedAt: null, status: { not: "DEACTIVATED" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, playerXId: true },
    take: 12,
  });
  for (const candidate of candidates) {
    if (await blockedWith(req.userId, candidate.playerXId)) continue;
    const claimed = await prisma.ticTacToeGame.updateMany({
      where: { id: candidate.id, status: "WAITING", playerOId: null },
      data: { playerOId: req.userId, turnUserId: candidate.playerXId, status: "ACTIVE" },
    });
    if (claimed.count) {
      const game = await prisma.ticTacToeGame.findUniqueOrThrow({ where: { id: candidate.id }, include: gameInclude });
      return res.status(201).json({ success: true, game: gamePayload(game, req.userId) });
    }
  }

  const game = await prisma.ticTacToeGame.create({ data: { playerXId: req.userId }, include: gameInclude });
  return res.status(201).json({ success: true, game: gamePayload(game, req.userId) });
}

export async function moveTicTacToe(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.gameId !== "string") return res.status(400).json({ success: false, message: "Invalid game." });
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose a valid square." });
  await tidyGames(req.userId);
  const game = await prisma.ticTacToeGame.findFirst({
    where: { id: req.params.gameId, status: "ACTIVE", OR: [{ playerXId: req.userId }, { playerOId: req.userId }] },
  });
  if (!game) return res.status(409).json({ success: false, message: "This match is no longer available." });
  if (game.turnUserId !== req.userId) return res.status(409).json({ success: false, message: "It is your opponent’s turn." });
  if (game.board[parsed.data.cell] !== ".") return res.status(409).json({ success: false, message: "That square is already taken." });

  const mark = game.playerXId === req.userId ? "X" : "O";
  const board = `${game.board.slice(0, parsed.data.cell)}${mark}${game.board.slice(parsed.data.cell + 1)}`;
  const winnerMark = winnerForBoard(board);
  const isDraw = !winnerMark && !board.includes(".");
  const now = new Date();
  const updated = await prisma.ticTacToeGame.update({
    where: { id: game.id },
    data: winnerMark || isDraw
      ? { board, status: "FINISHED", winnerUserId: winnerMark ? req.userId : null, turnUserId: null, finishedAt: now }
      : { board, turnUserId: game.playerXId === req.userId ? game.playerOId : game.playerXId },
    include: gameInclude,
  });
  return res.json({ success: true, game: gamePayload(updated, req.userId) });
}

export async function leaveTicTacToe(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.gameId !== "string") return res.status(400).json({ success: false, message: "Invalid game." });
  const result = await prisma.ticTacToeGame.updateMany({
    where: { id: req.params.gameId, status: { in: [TicTacToeGameStatus.WAITING, TicTacToeGameStatus.ACTIVE] }, OR: [{ playerXId: req.userId }, { playerOId: req.userId }] },
    data: { status: "CANCELLED", finishedAt: new Date(), turnUserId: null },
  });
  return res.json({ success: true, left: result.count > 0 });
}

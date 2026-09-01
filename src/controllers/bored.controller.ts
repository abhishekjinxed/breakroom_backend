import { Response } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { getPendingPaperPlanes, joinBoredQueue , leaveChat, respondToPaperPlane, sendCharterPaperPlane, sendPaperPlane } from "../services/bored.service";
import { notifyChatLeft, notifyInboxUpdated, notifyMatch, notifyPaperPlane } from "../socket";
import {
  stopLooking,
} from "../services/bored.service";

export async function joinBored(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const result = await joinBoredQueue(req.userId);

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("JOIN BORED ERROR:", error);

    if (error instanceof Error) {
      if (error.message === "USER_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (error.message === "ALREADY_IN_CHAT") {
        return res.status(409).json({
          success: false,
          message: "You are already in a chat",
        });
      }
    }

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to join bored queue",
    });
  }
}


export async function leaveBoredChat(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { otherUserId, ...result } = await leaveChat(req.userId);

    if (otherUserId && result.chatId) {
      notifyChatLeft(otherUserId, { chatId: result.chatId });
    }

    return res.json(result);
  } catch (error) {
    console.error("LEAVE CHAT ERROR:", error);

    if (error instanceof Error) {
      if (error.message === "USER_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (error.message === "NOT_IN_CHAT") {
        return res.status(409).json({
          success: false,
          message: "You are not currently in a chat",
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to leave chat",
    });
  }
}

export async function stopLookingController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required",
      });
    }

    const result =
      await stopLooking(
        req.userId
      );

    return res.json(result);
  } catch (error) {
    console.error(
      "STOP LOOKING ERROR:",
      error
    );

    if (
      error instanceof Error &&
      error.message ===
        "USER_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to stop looking",
    });
  }
}

const paperPlaneSchema = z.object({ message: z.string().trim().min(1).max(160) });
const paperPlaneResponseSchema = z.object({ accept: z.boolean() });

export async function sendPaperPlaneController(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = paperPlaneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a message up to 160 characters." });

  try {
    const { invite, recipient, balance } = await sendPaperPlane(req.userId, parsed.data.message);
    notifyPaperPlane(recipient.id, { id: invite.id, message: invite.message, isCharter: invite.isCharter, sender: invite.sender, expiresAt: invite.expiresAt });
    return res.status(201).json({ success: true, invite: { id: invite.id, message: invite.message, expiresAt: invite.expiresAt }, wallet: { balance, currency: "Paisa", paperPlaneCost: 10 } });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_AVAILABLE_RECIPIENT") {
      return res.status(409).json({ success: false, message: "No one is available for a break right now. Try again shortly." });
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_PAISA") {
      return res.status(402).json({ success: false, message: "You need 10 Paisa to send a Paper Plane." });
    }
    console.error("PAPER PLANE ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to send your paper plane." });
  }
}

export async function sendCharterPaperPlaneController(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.recipientId !== "string") return res.status(400).json({ success: false, message: "Choose a member for the Charter Plane." });
  const parsed = paperPlaneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Write a message up to 160 characters for the Charter Plane." });
  try {
    const { invite, recipient, balance } = await sendCharterPaperPlane(req.userId, req.params.recipientId, parsed.data.message);
    notifyPaperPlane(recipient.id, { id: invite.id, message: invite.message, isCharter: true, sender: invite.sender, expiresAt: invite.expiresAt });
    return res.status(201).json({ success: true, invite: { id: invite.id, message: invite.message, isCharter: true, expiresAt: invite.expiresAt }, wallet: { balance, currency: "Paisa", paperPlaneCost: 100 } });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CHARTER_RECIPIENT") return res.status(400).json({ success: false, message: "You cannot send a Charter Plane to your own desk." });
    if (error instanceof Error && error.message === "CHARTER_RECIPIENT_UNAVAILABLE") return res.status(404).json({ success: false, message: "This member is unavailable for a Charter Plane." });
    if (error instanceof Error && error.message === "CHARTER_ALREADY_SENT") return res.status(409).json({ success: false, message: "Your Charter Plane is already on this member’s desk for 24 hours." });
    if (error instanceof Error && error.message === "INSUFFICIENT_PAISA") return res.status(402).json({ success: false, message: "You need 100 Paisa to send a Charter Plane." });
    console.error("CHARTER PLANE ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to send the Charter Plane." });
  }
}

export async function getPendingPaperPlaneController(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const invites = await getPendingPaperPlanes(req.userId);
  return res.json({ success: true, invites });
}

export async function respondToPaperPlaneController(req: AuthenticatedRequest, res: Response) {
  if (!req.userId || typeof req.params.inviteId !== "string") return res.status(400).json({ success: false, message: "Invalid paper plane." });
  const parsed = paperPlaneResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Choose whether to accept the invitation." });

  try {
    const result = await respondToPaperPlane(req.userId, req.params.inviteId, parsed.data.accept);
    if (result.accepted && result.chatId) {
      // A Paper Plane becomes a persistent Inbox conversation. It must not
      // use match_found, which is reserved for the temporary quick-match UI.
      notifyInboxUpdated(req.userId, { chatId: result.chatId });
      notifyInboxUpdated(result.senderId, { chatId: result.chatId });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && ["PAPER_PLANE_NOT_FOUND", "PAPER_PLANE_UNAVAILABLE"].includes(error.message)) {
      return res.status(409).json({ success: false, message: "This paper plane is no longer available." });
    }
    console.error("PAPER PLANE RESPONSE ERROR:", error);
    const errorCode = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
    return res.status(500).json({ success: false, message: "Unable to respond to this paper plane.", errorCode });
  }
}

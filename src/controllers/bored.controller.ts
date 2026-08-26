import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { joinBoredQueue , leaveChat, } from "../services/bored.service";
import { notifyChatLeft } from "../socket";
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

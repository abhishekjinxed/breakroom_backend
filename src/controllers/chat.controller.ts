import { Response } from "express";

import { AuthenticatedRequest } from "../middleware/auth.middleware";

import {
  sendMessage,
  getChatMessages,
} from "../services/chat.service";

export async function createMessage(
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

    const chatId = req.params.chatId;
    const { text } = req.body;

    if (typeof chatId !== "string" || !chatId) {
      return res.status(400).json({
        success: false,
        message: "Chat ID is required",
      });
    }

    if (typeof text !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message text is required",
      });
    }

    const message = await sendMessage(
      req.userId,
      chatId,
      text
    );

    return res.status(201).json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("SEND MESSAGE ERROR:", error);

    if (error instanceof Error) {
      if (error.message === "EMPTY_MESSAGE") {
        return res.status(400).json({
          success: false,
          message: "Message cannot be empty",
        });
      }

      if (error.message === "MESSAGE_TOO_LONG") {
        return res.status(400).json({
          success: false,
          message: "Message cannot exceed 2000 characters",
        });
      }

      if (error.message === "CHAT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Chat not found",
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to send message",
    });
  }
}

export async function messages(
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

    const chatId = req.params.chatId;

    if (typeof chatId !== "string" || !chatId) {
      return res.status(400).json({
        success: false,
        message: "Chat ID is required",
      });
    }

    const result = await getChatMessages(
      req.userId,
      chatId
    );

    return res.json({
      success: true,
      messages: result,
    });
  } catch (error) {
    console.error("GET MESSAGES ERROR:", error);

    if (
      error instanceof Error &&
      error.message === "CHAT_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to get messages",
    });
  }
}

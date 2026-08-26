import { Router } from "express";

import {
  createMessage,
  messages,
} from "../controllers/chat.controller";

import {
  authenticate,
} from "../middleware/auth.middleware";

const router = Router();

router.post(
  "/:chatId/messages",
  authenticate,
  createMessage
);

router.get(
  "/:chatId/messages",
  authenticate,
  messages
);

export default router;
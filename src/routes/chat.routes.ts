import { Router } from "express";

import {
  createMessage,
  messages,
} from "../controllers/chat.controller";

import {
  authenticate,
} from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();

router.post(
  "/:chatId/messages",
  authenticate,
  requireTermsAcceptance,
  createMessage
);

router.get(
  "/:chatId/messages",
  authenticate,
  requireTermsAcceptance,
  messages
);

export default router;

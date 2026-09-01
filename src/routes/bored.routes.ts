import { Router } from "express";

import {
  joinBored,
  leaveBoredChat,
  getPendingPaperPlaneController,
  respondToPaperPlaneController,
  sendCharterPaperPlaneController,
  sendPaperPlaneController,
  stopLookingController,
} from "../controllers/bored.controller";

import {
  authenticate,
} from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();

router.post(
  "/join",
  authenticate,
  requireTermsAcceptance,
  joinBored
);

router.post(
  "/leave",
  authenticate,
  leaveBoredChat,
);

router.post(
  "/stop",
  authenticate,
  stopLookingController
);
router.get("/paper-plane", authenticate, requireTermsAcceptance, getPendingPaperPlaneController);
router.post("/paper-plane", authenticate, requireTermsAcceptance, sendPaperPlaneController);
router.post("/paper-plane/charter/:recipientId", authenticate, requireTermsAcceptance, sendCharterPaperPlaneController);
router.post("/paper-plane/:inviteId/respond", authenticate, requireTermsAcceptance, respondToPaperPlaneController);
export default router;

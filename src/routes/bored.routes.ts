import { Router } from "express";

import {
  getPendingPaperPlaneController,
  respondToPaperPlaneController,
  sendCharterPaperPlaneController,
  sendPaperPlaneController,
} from "../controllers/bored.controller";

import {
  authenticate,
} from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();

router.get("/paper-plane", authenticate, requireTermsAcceptance, getPendingPaperPlaneController);
router.post("/paper-plane", authenticate, requireTermsAcceptance, sendPaperPlaneController);
router.post("/paper-plane/charter/:recipientId", authenticate, requireTermsAcceptance, sendCharterPaperPlaneController);
router.post("/paper-plane/:inviteId/respond", authenticate, requireTermsAcceptance, respondToPaperPlaneController);
export default router;

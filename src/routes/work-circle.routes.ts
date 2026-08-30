import { Router } from "express";
import { listWorkCircle, openDirectChat, requestConnection, respondToConnection } from "../controllers/work-circle.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/", listWorkCircle);
router.post("/:userId/request", requestConnection);
router.post("/:id/respond", respondToConnection);
router.post("/:id/direct-chat", openDirectChat);
export default router;

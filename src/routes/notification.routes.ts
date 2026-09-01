import { Router } from "express";
import { listNotifications, markNotificationsRead } from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
router.use(authenticate);
router.get("/", listNotifications);
router.post("/read", markNotificationsRead);

export default router;

import { Router } from "express";
import { getMe, getPublicProfile, listMembers, updateMyProfile } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth.middleware";
import safetyRoutes from "./safety.routes";

const router = Router();

router.get("/me", authenticate, getMe);
router.put("/me", authenticate, updateMyProfile);
router.get("/users", authenticate, listMembers);
router.get("/users/:userId", authenticate, getPublicProfile);
router.use("/me", safetyRoutes);

export default router;

import { Router } from "express";
import { getMe } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth.middleware";
import safetyRoutes from "./safety.routes";

const router = Router();

router.get("/me", authenticate, getMe);
router.use("/me", safetyRoutes);

export default router;

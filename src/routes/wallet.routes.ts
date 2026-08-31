import { Router } from "express";
import { getWallet } from "../controllers/wallet.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
router.get("/", authenticate, getWallet);
export default router;

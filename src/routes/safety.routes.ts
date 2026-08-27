import { Router } from "express";
import { acceptTerms, blockUser, deleteMyAccount, reportContent } from "../controllers/safety.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
router.use(authenticate);
router.post("/reports", reportContent);
router.post("/blocks/:userId", blockUser);
router.post("/terms/accept", acceptTerms);
router.delete("/account", deleteMyAccount);
export default router;

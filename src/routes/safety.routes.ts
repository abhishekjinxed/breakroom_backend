import { Router } from "express";
import { acceptTerms, blockUser, deleteMyAccount, disableMemberAccount, getModeratorStatus, listReports, reportContent, resolveReport } from "../controllers/safety.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
router.use(authenticate);
router.post("/reports", reportContent);
router.post("/blocks/:userId", blockUser);
router.post("/terms/accept", acceptTerms);
router.delete("/account", deleteMyAccount);
router.get("/moderation/status", getModeratorStatus);
router.get("/moderation/reports", listReports);
router.patch("/moderation/reports/:reportId", resolveReport);
router.post("/moderation/members/:userId/disable", disableMemberAccount);
export default router;

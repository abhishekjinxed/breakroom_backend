import { Router } from "express";
import { answerChallenge, answerPrompt, giveKudos, joinCoffee, leaveCoffee, overview, updateInterests } from "../controllers/culture.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";
const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/", overview); router.post("/prompt", answerPrompt); router.post("/challenge", answerChallenge); router.put("/interests", updateInterests); router.post("/kudos", giveKudos); router.post("/coffee", joinCoffee); router.delete("/coffee", leaveCoffee);
export default router;

import { Router } from "express";
import { availability, currentCoffeeBreak, joinCoffeeBreak, leaveCoffeeBreak, sendCoffeeBreakMessage } from "../controllers/coffee-break.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/availability", availability);
router.get("/current", currentCoffeeBreak);
router.post("/join", joinCoffeeBreak);
router.delete("/leave", leaveCoffeeBreak);
router.post("/:roomId/messages", sendCoffeeBreakMessage);

export default router;

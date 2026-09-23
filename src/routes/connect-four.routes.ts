import { Router } from "express";
import { currentConnectFour, joinConnectFour, leaveConnectFour, moveConnectFour } from "../controllers/connect-four.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/current", currentConnectFour);
router.post("/join", joinConnectFour);
router.post("/:gameId/move", moveConnectFour);
router.delete("/:gameId/leave", leaveConnectFour);
export default router;

import { Router } from "express";
import { currentTicTacToe, joinTicTacToe, leaveTicTacToe, moveTicTacToe } from "../controllers/tic-tac-toe.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/current", currentTicTacToe);
router.post("/join", joinTicTacToe);
router.post("/:gameId/move", moveTicTacToe);
router.delete("/:gameId/leave", leaveTicTacToe);

export default router;

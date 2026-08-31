import { Router } from "express";
import { addStickyComment, createStickyNote, listStickyNotes, toggleStickyApplaud } from "../controllers/sticky-note.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/", listStickyNotes);
router.post("/", createStickyNote);
router.post("/:noteId/applaud", toggleStickyApplaud);
router.post("/:noteId/comments", addStickyComment);
export default router;

import { Router } from "express";
import { addStickyComment, createStickyNote, deleteStickyNote, listMyStickyNotes, listStickyNotes, replyToStickyComment, toggleStickyApplaud } from "../controllers/sticky-note.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate, requireTermsAcceptance);
router.get("/", listStickyNotes);
router.get("/mine", listMyStickyNotes);
router.post("/", createStickyNote);
router.post("/:noteId/applaud", toggleStickyApplaud);
router.post("/:noteId/comments", addStickyComment);
router.patch("/:noteId/comments/:commentId/reply", replyToStickyComment);
router.delete("/:noteId", deleteStickyNote);
export default router;

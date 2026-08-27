import { Router } from "express";
import { addNote, createPulse, listPulses, toggleApplaud } from "../controllers/pulse.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";

const router = Router();
router.use(authenticate);
router.use(requireTermsAcceptance);
router.get("/", listPulses);
router.post("/", createPulse);
router.post("/:pulseId/applaud", toggleApplaud);
router.post("/:pulseId/notes", addNote);
export default router;

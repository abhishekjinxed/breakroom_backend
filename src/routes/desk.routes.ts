import { Router } from "express";
import { getDeskQuote } from "../controllers/desk.controller";

const router = Router();
router.get("/quote", getDeskQuote);
export default router;

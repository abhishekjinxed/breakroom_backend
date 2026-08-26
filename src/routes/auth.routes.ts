import { Router } from "express";
import { anonymousLogin, googleLogin } from "../controllers/auth.controller";

const router = Router();

router.post("/anonymous", anonymousLogin);
router.post("/google", googleLogin);

export default router;

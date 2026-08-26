import { Router } from "express";

import {
  joinBored,
  leaveBoredChat,
  stopLookingController,
} from "../controllers/bored.controller";

import {
  authenticate,
} from "../middleware/auth.middleware";

const router = Router();

router.post(
  "/join",
  authenticate,
  joinBored
);

router.post(
  "/leave",
  authenticate,
  leaveBoredChat,
);

router.post(
  "/stop",
  authenticate,
  stopLookingController
);
export default router;

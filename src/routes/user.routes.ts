import { Router } from "express";
import { addMyProfilePhoto, deleteMyProfilePhoto, getMe, getPublicProfile, listMembers, listMyProfilePhotos, updateMyProfile, updateMyProfilePhoto } from "../controllers/user.controller";
import { authenticate } from "../middleware/auth.middleware";
import safetyRoutes from "./safety.routes";

const router = Router();

router.get("/me", authenticate, getMe);
router.put("/me", authenticate, updateMyProfile);
router.get("/me/profile-photos", authenticate, listMyProfilePhotos);
router.post("/me/profile-photos", authenticate, addMyProfilePhoto);
router.patch("/me/profile-photos/:photoId", authenticate, updateMyProfilePhoto);
router.delete("/me/profile-photos/:photoId", authenticate, deleteMyProfilePhoto);
router.get("/users", authenticate, listMembers);
router.get("/users/:userId", authenticate, getPublicProfile);
router.use("/me", safetyRoutes);

export default router;

import { Router } from "express";
import { deleteConversation, listInbox, readConversation, updateChatPhotoSharing, updateProfileSharing } from "../controllers/inbox.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";
const router = Router(); router.use(authenticate, requireTermsAcceptance);
router.get("/", listInbox); router.get("/:id/messages", readConversation); router.patch("/:id/profile-sharing", updateProfileSharing); router.patch("/:id/profile-photos/:photoId", updateChatPhotoSharing); router.delete("/:id", deleteConversation);
export default router;

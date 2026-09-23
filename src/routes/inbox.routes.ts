import { Router } from "express";
import { deleteConversation, listInbox, offerConversationPrompt, readConversation, respondToConversationPrompt, updateChatPhotoSharing, updateFriendshipLevel, updateProfileSharing } from "../controllers/inbox.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireTermsAcceptance } from "../middleware/terms.middleware";
const router = Router(); router.use(authenticate, requireTermsAcceptance);
router.get("/", listInbox); router.get("/:id/messages", readConversation); router.patch("/:id/profile-sharing", updateProfileSharing); router.patch("/:id/profile-photos/:photoId", updateChatPhotoSharing); router.post("/:id/friendship-level", updateFriendshipLevel); router.post("/:id/prompts", offerConversationPrompt); router.post("/:id/prompts/:promptId", respondToConversationPrompt); router.delete("/:id", deleteConversation);
export default router;

ALTER TYPE "ReportTargetType" ADD VALUE 'PROFILE_PHOTO';
ALTER TYPE "ReportTargetType" ADD VALUE 'PAPER_PLANE';
ALTER TYPE "ReportTargetType" ADD VALUE 'PROMPT_ANSWER';

CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
CREATE INDEX "StickyNoteComment_authorId_createdAt_idx" ON "StickyNoteComment"("authorId", "createdAt");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");

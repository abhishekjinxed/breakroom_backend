ALTER TABLE "DeskStickyNote" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "DeskStickyNote_deletedAt_idx" ON "DeskStickyNote"("deletedAt");

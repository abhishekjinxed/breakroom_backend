ALTER TABLE "DeskStickyNote"
  ADD COLUMN "mood" VARCHAR(24) NOT NULL DEFAULT 'THOUGHT',
  ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "DeskStickyNote_authorId_pinnedAt_idx" ON "DeskStickyNote"("authorId", "pinnedAt");

CREATE TABLE "StickyNoteMeToo" (
  "userId" TEXT NOT NULL,
  "stickyNoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StickyNoteMeToo_pkey" PRIMARY KEY ("userId", "stickyNoteId")
);
CREATE INDEX "StickyNoteMeToo_stickyNoteId_idx" ON "StickyNoteMeToo"("stickyNoteId");
ALTER TABLE "StickyNoteMeToo" ADD CONSTRAINT "StickyNoteMeToo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickyNoteMeToo" ADD CONSTRAINT "StickyNoteMeToo_stickyNoteId_fkey" FOREIGN KEY ("stickyNoteId") REFERENCES "DeskStickyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SavedStickyNote" (
  "userId" TEXT NOT NULL,
  "stickyNoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedStickyNote_pkey" PRIMARY KEY ("userId", "stickyNoteId")
);
CREATE INDEX "SavedStickyNote_stickyNoteId_idx" ON "SavedStickyNote"("stickyNoteId");
ALTER TABLE "SavedStickyNote" ADD CONSTRAINT "SavedStickyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedStickyNote" ADD CONSTRAINT "SavedStickyNote_stickyNoteId_fkey" FOREIGN KEY ("stickyNoteId") REFERENCES "DeskStickyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

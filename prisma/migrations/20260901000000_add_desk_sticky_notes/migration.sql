ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'STICKY_NOTE';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'STICKY_COMMENT';

CREATE TABLE "DeskStickyNote" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "text" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeskStickyNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StickyNoteApplaud" (
  "userId" TEXT NOT NULL,
  "stickyNoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StickyNoteApplaud_pkey" PRIMARY KEY ("userId", "stickyNoteId")
);

CREATE TABLE "StickyNoteComment" (
  "id" TEXT NOT NULL,
  "stickyNoteId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "text" VARCHAR(300) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StickyNoteComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeskStickyNote_createdAt_idx" ON "DeskStickyNote"("createdAt");
CREATE INDEX "DeskStickyNote_authorId_createdAt_idx" ON "DeskStickyNote"("authorId", "createdAt");
CREATE INDEX "StickyNoteApplaud_stickyNoteId_idx" ON "StickyNoteApplaud"("stickyNoteId");
CREATE INDEX "StickyNoteComment_stickyNoteId_createdAt_idx" ON "StickyNoteComment"("stickyNoteId", "createdAt");

ALTER TABLE "DeskStickyNote" ADD CONSTRAINT "DeskStickyNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickyNoteApplaud" ADD CONSTRAINT "StickyNoteApplaud_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickyNoteApplaud" ADD CONSTRAINT "StickyNoteApplaud_stickyNoteId_fkey" FOREIGN KEY ("stickyNoteId") REFERENCES "DeskStickyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickyNoteComment" ADD CONSTRAINT "StickyNoteComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickyNoteComment" ADD CONSTRAINT "StickyNoteComment_stickyNoteId_fkey" FOREIGN KEY ("stickyNoteId") REFERENCES "DeskStickyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

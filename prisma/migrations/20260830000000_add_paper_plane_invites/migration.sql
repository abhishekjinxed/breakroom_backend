CREATE TYPE "PaperPlaneStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "PaperPlaneInvite" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "message" VARCHAR(160) NOT NULL,
  "status" "PaperPlaneStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),

  CONSTRAINT "PaperPlaneInvite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaperPlaneInvite"
  ADD CONSTRAINT "PaperPlaneInvite_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaperPlaneInvite"
  ADD CONSTRAINT "PaperPlaneInvite_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PaperPlaneInvite_recipientId_status_expiresAt_idx"
  ON "PaperPlaneInvite"("recipientId", "status", "expiresAt");

CREATE INDEX "PaperPlaneInvite_senderId_status_idx"
  ON "PaperPlaneInvite"("senderId", "status");

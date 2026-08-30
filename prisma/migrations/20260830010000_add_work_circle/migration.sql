CREATE TYPE "WorkCircleStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

CREATE TABLE "WorkCircleConnection" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "status" "WorkCircleStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "WorkCircleConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkCircleConnection_requesterId_recipientId_key" ON "WorkCircleConnection"("requesterId", "recipientId");
CREATE INDEX "WorkCircleConnection_recipientId_status_idx" ON "WorkCircleConnection"("recipientId", "status");

ALTER TABLE "WorkCircleConnection" ADD CONSTRAINT "WorkCircleConnection_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkCircleConnection" ADD CONSTRAINT "WorkCircleConnection_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chat" ADD COLUMN "isDirect" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DEACTIVATED';

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

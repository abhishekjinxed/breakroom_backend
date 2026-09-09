ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'PAPER_PLANE';
ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'CHARTER_PLANE';
ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'DIRECT_MESSAGE';
ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'CONVERSATION_ENDED';

CREATE TABLE "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" VARCHAR(255) NOT NULL,
  "platform" VARCHAR(16) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX "PushDevice_userId_updatedAt_idx" ON "PushDevice"("userId", "updatedAt");
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

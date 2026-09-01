CREATE TYPE "AppNotificationType" AS ENUM ('STICKY_NOTE_COMMENT', 'STICKY_NOTE_REPLY');

CREATE TABLE "AppNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "AppNotificationType" NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "detail" VARCHAR(400) NOT NULL,
  "link" VARCHAR(500),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppNotification_userId_readAt_createdAt_idx" ON "AppNotification"("userId", "readAt", "createdAt");

ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

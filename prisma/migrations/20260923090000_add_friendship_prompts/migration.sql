CREATE TYPE "FriendshipLevel" AS ENUM ('STRANGER', 'ACQUAINTANCE', 'FRIEND', 'CLOSE_FRIEND');
CREATE TYPE "ConversationPromptStatus" AS ENUM ('OFFERED', 'ACTIVE', 'COMPLETED', 'DECLINED');

ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'CONNECTION_UPDATE';

ALTER TABLE "Chat"
  ADD COLUMN "friendshipLevel" "FriendshipLevel" NOT NULL DEFAULT 'STRANGER',
  ADD COLUMN "levelRequest" "FriendshipLevel",
  ADD COLUMN "levelRequestedById" TEXT;

CREATE INDEX "Chat_friendshipLevel_idx" ON "Chat"("friendshipLevel");

CREATE TABLE "ConversationPrompt" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "question" VARCHAR(320) NOT NULL,
  "targetLevel" "FriendshipLevel" NOT NULL,
  "status" "ConversationPromptStatus" NOT NULL DEFAULT 'OFFERED',
  "proposerId" TEXT NOT NULL,
  "user1Accepted" BOOLEAN NOT NULL DEFAULT false,
  "user2Accepted" BOOLEAN NOT NULL DEFAULT false,
  "user1Answer" VARCHAR(600),
  "user2Answer" VARCHAR(600),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ConversationPrompt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationPrompt_chatId_status_createdAt_idx" ON "ConversationPrompt"("chatId", "status", "createdAt");
ALTER TABLE "ConversationPrompt" ADD CONSTRAINT "ConversationPrompt_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

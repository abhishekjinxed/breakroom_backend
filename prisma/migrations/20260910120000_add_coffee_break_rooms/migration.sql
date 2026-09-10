CREATE TYPE "CoffeeBreakRoomStatus" AS ENUM ('WAITING', 'ACTIVE', 'ENDED', 'CANCELLED');

ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'COFFEE_MESSAGE';

CREATE TABLE "CoffeeBreakRoom" (
  "id" TEXT NOT NULL,
  "status" "CoffeeBreakRoomStatus" NOT NULL DEFAULT 'WAITING',
  "prompt" VARCHAR(240) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "CoffeeBreakRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoffeeBreakParticipant" (
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "CoffeeBreakParticipant_pkey" PRIMARY KEY ("roomId", "userId")
);

CREATE TABLE "CoffeeBreakMessage" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "text" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoffeeBreakMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoffeeBreakRoom_status_createdAt_idx" ON "CoffeeBreakRoom"("status", "createdAt");
CREATE INDEX "CoffeeBreakRoom_status_endsAt_idx" ON "CoffeeBreakRoom"("status", "endsAt");
CREATE INDEX "CoffeeBreakParticipant_userId_leftAt_idx" ON "CoffeeBreakParticipant"("userId", "leftAt");
CREATE INDEX "CoffeeBreakMessage_roomId_createdAt_idx" ON "CoffeeBreakMessage"("roomId", "createdAt");

ALTER TABLE "CoffeeBreakParticipant" ADD CONSTRAINT "CoffeeBreakParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CoffeeBreakRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoffeeBreakParticipant" ADD CONSTRAINT "CoffeeBreakParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoffeeBreakMessage" ADD CONSTRAINT "CoffeeBreakMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CoffeeBreakRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoffeeBreakMessage" ADD CONSTRAINT "CoffeeBreakMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

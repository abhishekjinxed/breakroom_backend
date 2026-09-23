CREATE TABLE "ConnectFourGame" (
  "id" TEXT NOT NULL,
  "playerRedId" TEXT NOT NULL,
  "playerYellowId" TEXT,
  "board" VARCHAR(42) NOT NULL DEFAULT '..........................................',
  "turnUserId" TEXT,
  "winnerUserId" TEXT,
  "status" "TicTacToeGameStatus" NOT NULL DEFAULT 'WAITING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ConnectFourGame_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConnectFourGame_status_createdAt_idx" ON "ConnectFourGame"("status", "createdAt");
CREATE INDEX "ConnectFourGame_playerRedId_status_idx" ON "ConnectFourGame"("playerRedId", "status");
CREATE INDEX "ConnectFourGame_playerYellowId_status_idx" ON "ConnectFourGame"("playerYellowId", "status");
ALTER TABLE "ConnectFourGame" ADD CONSTRAINT "ConnectFourGame_playerRedId_fkey" FOREIGN KEY ("playerRedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectFourGame" ADD CONSTRAINT "ConnectFourGame_playerYellowId_fkey" FOREIGN KEY ("playerYellowId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConnectFourGame" ADD CONSTRAINT "ConnectFourGame_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

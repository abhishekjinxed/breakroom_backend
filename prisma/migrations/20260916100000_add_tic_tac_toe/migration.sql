-- CreateEnum
CREATE TYPE "TicTacToeGameStatus" AS ENUM ('WAITING', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TicTacToeGame" (
  "id" TEXT NOT NULL,
  "playerXId" TEXT NOT NULL,
  "playerOId" TEXT,
  "board" VARCHAR(9) NOT NULL DEFAULT '.........',
  "turnUserId" TEXT,
  "winnerUserId" TEXT,
  "status" "TicTacToeGameStatus" NOT NULL DEFAULT 'WAITING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "TicTacToeGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicTacToeGame_status_createdAt_idx" ON "TicTacToeGame"("status", "createdAt");
CREATE INDEX "TicTacToeGame_playerXId_status_idx" ON "TicTacToeGame"("playerXId", "status");
CREATE INDEX "TicTacToeGame_playerOId_status_idx" ON "TicTacToeGame"("playerOId", "status");

-- AddForeignKey
ALTER TABLE "TicTacToeGame" ADD CONSTRAINT "TicTacToeGame_playerXId_fkey" FOREIGN KEY ("playerXId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicTacToeGame" ADD CONSTRAINT "TicTacToeGame_playerOId_fkey" FOREIGN KEY ("playerOId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicTacToeGame" ADD CONSTRAINT "TicTacToeGame_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

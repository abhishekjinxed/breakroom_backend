CREATE TABLE "PaisaWallet" (
  "userId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 50000,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaisaWallet_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "PaisaWallet" ADD CONSTRAINT "PaisaWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

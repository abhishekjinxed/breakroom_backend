CREATE TABLE "CoffeeQueue" (
  "userId" TEXT NOT NULL,
  "topic" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoffeeQueue_pkey" PRIMARY KEY ("userId")
);
CREATE INDEX "CoffeeQueue_topic_createdAt_idx" ON "CoffeeQueue"("topic", "createdAt");

CREATE TABLE "DailyDeskResponse" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "promptDate" DATE NOT NULL,
  "text" VARCHAR(240) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyDeskResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyDeskResponse_userId_promptDate_key" ON "DailyDeskResponse"("userId", "promptDate");
CREATE INDEX "DailyDeskResponse_promptDate_createdAt_idx" ON "DailyDeskResponse"("promptDate", "createdAt");

CREATE TABLE "CultureChallengeResponse" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "challengeKey" VARCHAR(40) NOT NULL,
  "text" VARCHAR(160) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CultureChallengeResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CultureChallengeResponse_userId_challengeKey_key" ON "CultureChallengeResponse"("userId", "challengeKey");
CREATE INDEX "CultureChallengeResponse_challengeKey_createdAt_idx" ON "CultureChallengeResponse"("challengeKey", "createdAt");

CREATE TABLE "UserInterest" ("userId" TEXT NOT NULL, "interest" VARCHAR(40) NOT NULL, CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("userId", "interest"));
CREATE TABLE "Kudos" ("id" TEXT NOT NULL, "senderId" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "message" VARCHAR(240) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Kudos_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Kudos_createdAt_idx" ON "Kudos"("createdAt");
CREATE INDEX "Kudos_recipientId_createdAt_idx" ON "Kudos"("recipientId", "createdAt");

ALTER TABLE "CoffeeQueue" ADD CONSTRAINT "CoffeeQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyDeskResponse" ADD CONSTRAINT "DailyDeskResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CultureChallengeResponse" ADD CONSTRAINT "CultureChallengeResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

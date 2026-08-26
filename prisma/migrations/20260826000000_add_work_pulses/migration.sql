CREATE TYPE "PulseMediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "WorkPulse" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" "PulseMediaType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkPulse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PulseApplaud" (
    "userId" TEXT NOT NULL,
    "pulseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PulseApplaud_pkey" PRIMARY KEY ("userId", "pulseId")
);

CREATE TABLE "PulseNote" (
    "id" TEXT NOT NULL,
    "pulseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PulseNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkPulse_createdAt_idx" ON "WorkPulse"("createdAt");
CREATE INDEX "PulseApplaud_pulseId_idx" ON "PulseApplaud"("pulseId");
CREATE INDEX "PulseNote_pulseId_createdAt_idx" ON "PulseNote"("pulseId", "createdAt");

ALTER TABLE "WorkPulse" ADD CONSTRAINT "WorkPulse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PulseApplaud" ADD CONSTRAINT "PulseApplaud_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PulseApplaud" ADD CONSTRAINT "PulseApplaud_pulseId_fkey" FOREIGN KEY ("pulseId") REFERENCES "WorkPulse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PulseNote" ADD CONSTRAINT "PulseNote_pulseId_fkey" FOREIGN KEY ("pulseId") REFERENCES "WorkPulse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PulseNote" ADD CONSTRAINT "PulseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

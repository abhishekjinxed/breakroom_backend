ALTER TABLE "WorkPulse" ADD COLUMN "isBreakBrief" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "WorkPulse_isBreakBrief_createdAt_idx" ON "WorkPulse"("isBreakBrief", "createdAt");

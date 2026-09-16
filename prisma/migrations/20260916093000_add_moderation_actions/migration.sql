ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'ACTIONED';
ALTER TYPE "AppNotificationType" ADD VALUE IF NOT EXISTS 'MODERATION_ACTION';

CREATE TABLE "ModerationAction" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationAction_reportId_key" ON "ModerationAction"("reportId");
CREATE UNIQUE INDEX "ModerationAction_targetType_targetId_key" ON "ModerationAction"("targetType", "targetId");
CREATE INDEX "ModerationAction_targetType_targetId_idx" ON "ModerationAction"("targetType", "targetId");
CREATE INDEX "ModerationAction_authorId_createdAt_idx" ON "ModerationAction"("authorId", "createdAt");

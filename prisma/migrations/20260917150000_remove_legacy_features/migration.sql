-- The desk-first experience no longer exposes Pulse, Briefs, Culture Hub,
-- member discovery, Work Circle, or quick matching. These tables only served
-- those retired features. Paper Plane chats are intentionally kept in Chat.

ALTER TABLE "Chat" DROP COLUMN IF EXISTS "connectionId";

DROP TABLE IF EXISTS "PulseNote" CASCADE;
DROP TABLE IF EXISTS "PulseApplaud" CASCADE;
DROP TABLE IF EXISTS "WorkPulse" CASCADE;
DROP TABLE IF EXISTS "WorkCircleConnection" CASCADE;
DROP TABLE IF EXISTS "DailyDeskResponse" CASCADE;
DROP TABLE IF EXISTS "CultureChallengeResponse" CASCADE;
DROP TABLE IF EXISTS "UserInterest" CASCADE;
DROP TABLE IF EXISTS "Kudos" CASCADE;

DROP TYPE IF EXISTS "PulseMediaType";
DROP TYPE IF EXISTS "WorkCircleStatus";
DROP TYPE IF EXISTS "ConnectionRequestType";

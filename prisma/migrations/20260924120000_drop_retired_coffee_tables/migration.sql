-- These tables belonged to the retired Coffee Break Rooms feature. The
-- current application and Prisma schema no longer read or write them.
-- Drop child tables before the room table to remove their foreign keys cleanly.
DROP TABLE IF EXISTS "CoffeeBreakMessage";
DROP TABLE IF EXISTS "CoffeeBreakParticipant";
DROP TABLE IF EXISTS "CoffeeBreakRoom";
DROP TABLE IF EXISTS "CoffeeQueue";

DROP TYPE IF EXISTS "CoffeeBreakRoomStatus";

-- Keep ReportTargetType.COFFEE_MESSAGE: old reports can still reference it.

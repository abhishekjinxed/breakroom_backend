CREATE TYPE "ProfilePhotoVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

CREATE TABLE "ProfilePhoto" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "url" VARCHAR(1000) NOT NULL,
  "visibility" "ProfilePhotoVisibility" NOT NULL DEFAULT 'PRIVATE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfilePhotoShare" (
  "photoId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfilePhotoShare_pkey" PRIMARY KEY ("photoId", "recipientId")
);

CREATE INDEX "ProfilePhoto_ownerId_createdAt_idx" ON "ProfilePhoto"("ownerId", "createdAt");
CREATE INDEX "ProfilePhoto_ownerId_visibility_idx" ON "ProfilePhoto"("ownerId", "visibility");
CREATE INDEX "ProfilePhotoShare_recipientId_idx" ON "ProfilePhotoShare"("recipientId");

ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePhotoShare" ADD CONSTRAINT "ProfilePhotoShare_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ProfilePhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePhotoShare" ADD CONSTRAINT "ProfilePhotoShare_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

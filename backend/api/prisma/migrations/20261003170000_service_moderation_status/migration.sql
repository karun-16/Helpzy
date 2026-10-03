-- AlterTable
-- Adds the moderation state a listing is in. `APPROVED` is the column
-- default so every listing that predates moderation stays live exactly
-- as it was: such a listing has already been published, so it is
-- treated as approved. A listing created while the platform requires
-- moderation before publish starts as PENDING and only becomes live
-- once an admin approves it.
ALTER TABLE "services" ADD COLUMN     "moderationStatus" VARCHAR(32) NOT NULL DEFAULT 'APPROVED';

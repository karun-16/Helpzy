-- Platform settings, plus the notification types the schema already declared but
-- the previous migration never actually added to the database.
--
-- The seven NotificationType values below are a repair, not new work. They were
-- written into
-- 20261003120000_booking_reschedule_payments_verification_documents/migration.sql
-- *after* that migration had already been applied, so its recorded checksum no
-- longer matches the file on disk and the ALTER TYPE statements inside it never
-- ran against this database. The schema has declared these values and the
-- reschedule, completion and cash-confirmation code inserts them, so any of those
-- flows would have failed at runtime with an invalid-enum-value error.
--
-- They are added here, in a new migration, rather than by editing the applied
-- file: rewriting a migration that has already run is how two environments end up
-- with different schemas.

-- AlterEnum
-- PLATFORM_SETTING records an admin changing a platform-wide rule.
ALTER TYPE "AuditEntityType" ADD VALUE 'PLATFORM_SETTING';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLETION_AWAITING_CUSTOMER';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLETION_AWAITING_PROFESSIONAL';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_METHOD_SELECTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_AWAITING_BOTH';

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'MAIN',
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
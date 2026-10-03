-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REFUNDED';

-- AlterTable
ALTER TABLE "booking_status_history" ADD COLUMN     "isOverride" BOOLEAN NOT NULL DEFAULT false;

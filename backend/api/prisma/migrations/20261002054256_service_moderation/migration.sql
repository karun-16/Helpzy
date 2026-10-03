-- AlterTable
ALTER TABLE "services" ADD COLUMN     "moderatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "moderationNote" VARCHAR(500);

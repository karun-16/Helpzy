-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('PROFESSIONAL', 'SERVICE', 'BOOKING', 'REVIEW');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('INAPPROPRIATE_CONTENT', 'FRAUD_OR_SCAM', 'HARASSMENT', 'MISLEADING_LISTING', 'UNSAFE_OR_UNPROFESSIONAL', 'NO_SHOW', 'PAYMENT_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('SERVICE_NOT_AS_DESCRIBED', 'NO_SHOW', 'QUALITY_ISSUE', 'PROPERTY_DAMAGE', 'PAYMENT_ISSUE', 'UNSAFE_BEHAVIOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeEventType" AS ENUM ('OPENED', 'MESSAGE', 'STATUS_CHANGE', 'RESOLUTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'REPORT';
ALTER TYPE "AuditEntityType" ADD VALUE 'DISPUTE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_OPENED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_FILED_ABOUT_YOU';

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "targetOwnerId" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" VARCHAR(1000),
    "resolutionAction" VARCHAR(100),
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "againstId" UUID NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" VARCHAR(2000),
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_events" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" "DisputeEventType" NOT NULL,
    "body" VARCHAR(2000),
    "fromStatus" "DisputeStatus",
    "toStatus" "DisputeStatus",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "reports_targetOwnerId_status_idx" ON "reports"("targetOwnerId", "status");

-- CreateIndex
CREATE INDEX "reports_reporterId_createdAt_idx" ON "reports"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_bookingId_idx" ON "disputes"("bookingId");

-- CreateIndex
CREATE INDEX "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_againstId_status_idx" ON "disputes"("againstId", "status");

-- CreateIndex
CREATE INDEX "dispute_events_disputeId_createdAt_idx" ON "dispute_events"("disputeId", "createdAt");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_againstId_fkey" FOREIGN KEY ("againstId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

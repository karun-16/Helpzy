-- Booking rescheduling, mutual completion, cash payments and verification documents.

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VerificationDocumentType" AS ENUM ('AADHAAR', 'PAN', 'GST_CERTIFICATE', 'BUSINESS_LICENCE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- CASH is a distinct method from DIRECT: it needs confirmation from both
-- parties, whereas DIRECT is settled by the professional's receipt alone.
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- AlterEnum
-- DISPUTED holds a recorded payment for review rather than moving the money.
ALTER TYPE "PaymentStatus" ADD VALUE 'DISPUTED';

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'RESCHEDULE_PENDING';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'VERIFICATION_DOCUMENT';

-- AlterTable
ALTER TABLE "bookings"
ADD COLUMN     "completedByProfessionalId" UUID,
ADD COLUMN     "completedByProfessionalAt" TIMESTAMPTZ(3),
ADD COLUMN     "completedByCustomerId" UUID,
ADD COLUMN     "completedByCustomerAt" TIMESTAMPTZ(3),
ADD COLUMN     "rescheduleRequestId" UUID,
ADD COLUMN     "rescheduleReturnStatus" "BookingStatus";

-- AlterTable
ALTER TABLE "payments"
ADD COLUMN     "gatewayTransactionId" TEXT,
ADD COLUMN     "gatewayMethod" TEXT,
ADD COLUMN     "gatewayVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashConfirmedByCustomerId" UUID,
ADD COLUMN     "cashConfirmedByCustomerAt" TIMESTAMPTZ(3),
ADD COLUMN     "cashConfirmedByProfessionalId" UUID,
ADD COLUMN     "cashConfirmedByProfessionalAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "reschedule_requests" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "previousStart" TIMESTAMPTZ(3) NOT NULL,
    "previousEnd" TIMESTAMPTZ(3) NOT NULL,
    "proposedStart" TIMESTAMPTZ(3) NOT NULL,
    "proposedEnd" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(500),
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" VARCHAR(500),
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "type" "VerificationDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "originalName" VARCHAR(255),
    "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" VARCHAR(1000),
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_document_reviews" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "VerificationDocumentStatus" NOT NULL,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paymentId" UUID,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_rescheduleRequestId_key" ON "bookings"("rescheduleRequestId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completedByProfessionalId_fkey" FOREIGN KEY ("completedByProfessionalId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completedByCustomerId_fkey" FOREIGN KEY ("completedByCustomerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rescheduleRequestId_fkey" FOREIGN KEY ("rescheduleRequestId") REFERENCES "reschedule_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashConfirmedByCustomerId_fkey" FOREIGN KEY ("cashConfirmedByCustomerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashConfirmedByProfessionalId_fkey" FOREIGN KEY ("cashConfirmedByProfessionalId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_document_reviews" ADD CONSTRAINT "verification_document_reviews_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "verification_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_document_reviews" ADD CONSTRAINT "verification_document_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "reschedule_requests_bookingId_createdAt_idx" ON "reschedule_requests"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "reschedule_requests_status_createdAt_idx" ON "reschedule_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "verification_documents_professionalId_type_status_idx" ON "verification_documents"("professionalId", "type", "status");

-- CreateIndex
CREATE INDEX "verification_documents_status_submittedAt_idx" ON "verification_documents"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "verification_document_reviews_documentId_createdAt_idx" ON "verification_document_reviews"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_providerEventId_key" ON "payment_webhook_events"("providerEventId");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_receivedAt_idx" ON "payment_webhook_events"("provider", "receivedAt");


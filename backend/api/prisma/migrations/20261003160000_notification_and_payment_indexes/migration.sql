-- A withdrawn reschedule request, and the index the gateway callback looks a
-- payment up by.
--
-- Two independent additions, both additive: one enum label and one index. Neither
-- rewrites an existing table's data, so neither needs a backfill and neither can
-- lose a row.
--
-- BOOKING_RESCHEDULE_WITHDRAWN is separate from REJECTED because the two events
-- reach different people. A rejection is the other party saying no; a withdrawal
-- is the proposer taking the request back, and the person who was asked to answer
-- is the one who needs to hear about it.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_WITHDRAWN';

-- CreateIndex
-- Every gateway callback resolves its payment by this column, including the
-- retries gateways send routinely, so it is read on the payment hot path rather
-- than only on the one checkout that created it.
CREATE INDEX "payments_gatewayTransactionId_idx" ON "payments"("gatewayTransactionId");
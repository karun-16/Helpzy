import {
  BOOKING_LIFECYCLE,
  CUSTOMER_LIFECYCLE_STATUS,
  PROFESSIONAL_LIFECYCLE_STATUSES,
  isProfessionalLifecycleStatus,
  previousBookingLifecycleStatus,
  type BookingStatus,
  type ProfessionalLifecycleStatus,
} from '@helpzy/types';

/**
 * The booking state machine, as consumed by the API.
 *
 * The rules themselves live in `@helpzy/types` next to `BOOKING_STATUSES`,
 * which the Prisma schema already treats as the source of truth for the domain
 * vocabulary. Keeping them in one place means the enforcement here and the
 * "next action" affordances in the apps can never drift apart.
 */
export const LIFECYCLE_SEQUENCE = BOOKING_LIFECYCLE;
export const PROFESSIONAL_LIFECYCLE_ACTIONS = PROFESSIONAL_LIFECYCLE_STATUSES;
export const CUSTOMER_LIFECYCLE_ACTION = CUSTOMER_LIFECYCLE_STATUS;

export { isProfessionalLifecycleStatus, previousBookingLifecycleStatus };
export type { BookingStatus, ProfessionalLifecycleStatus };

/** True when the destination status is the one step the customer owns. */
export function isCustomerOwnedTransition(next: BookingStatus): boolean {
  return next === CUSTOMER_LIFECYCLE_STATUS;
}

/**
 * Platform independent union helpers.
 *
 * TypeScript `enum` is avoided on purpose: `const` object + derived union gives
 * the same exhaustiveness benefits, emits real JavaScript objects (so the values
 * exist at runtime for both the API and the app bundle) and stays compatible
 * with `isolatedModules` and Babel/Metro transpilation.
 */

export const ROLES = {
  CUSTOMER: 'CUSTOMER',
  PROFESSIONAL: 'PROFESSIONAL',
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = [ROLES.CUSTOMER, ROLES.PROFESSIONAL, ROLES.ADMIN];

/**
 * Full booking lifecycle.
 *
 * Happy path:
 *   REQUESTED -> ACCEPTED -> SCHEDULED -> ON_THE_WAY -> IN_PROGRESS
 *             -> COMPLETED_BY_PROFESSIONAL -> CUSTOMER_CONFIRMED
 *             -> PAYMENT_PENDING -> PAID -> CLOSED
 *
 * Terminal / exception states: REJECTED, CANCELLED, DISPUTED.
 *
 * Server-side transition validation arrives with the booking engine (PHASE 7);
 * these values are the single source of truth for the state machine.
 */
export const BOOKING_STATUSES = {
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  SCHEDULED: 'SCHEDULED',
  ON_THE_WAY: 'ON_THE_WAY',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED_BY_PROFESSIONAL: 'COMPLETED_BY_PROFESSIONAL',
  CUSTOMER_CONFIRMED: 'CUSTOMER_CONFIRMED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
} as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];

/** Statuses from which no further transition is allowed. */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.PAID,
  BOOKING_STATUSES.CLOSED,
  BOOKING_STATUSES.REJECTED,
  BOOKING_STATUSES.CANCELLED,
];

/**
 * The post-acceptance booking lifecycle, in the only order the statuses may be
 * reached. Both the API (which enforces it) and the apps (which render the next
 * action) derive from this list so the state machine is never described twice.
 *
 * `COMPLETED_BY_PROFESSIONAL` is the boundary between the two actors: everything
 * up to it is professional-controlled, and `CUSTOMER_CONFIRMED` is owned by the
 * customer who holds the booking. Payment then extends the chain to `CLOSED`.
 */
export const BOOKING_LIFECYCLE: readonly BookingStatus[] = [
  BOOKING_STATUSES.ACCEPTED,
  BOOKING_STATUSES.SCHEDULED,
  BOOKING_STATUSES.ON_THE_WAY,
  BOOKING_STATUSES.IN_PROGRESS,
  BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.PAYMENT_PENDING,
  BOOKING_STATUSES.PAID,
  BOOKING_STATUSES.CLOSED,
];

/** The lifecycle step a professional may perform from each of these statuses. */
export const PROFESSIONAL_LIFECYCLE_STATUSES = [
  BOOKING_STATUSES.SCHEDULED,
  BOOKING_STATUSES.ON_THE_WAY,
  BOOKING_STATUSES.IN_PROGRESS,
  BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
] as const;

export type ProfessionalLifecycleStatus = (typeof PROFESSIONAL_LIFECYCLE_STATUSES)[number];

/** The single lifecycle step a customer may perform. */
export const CUSTOMER_LIFECYCLE_STATUS = BOOKING_STATUSES.CUSTOMER_CONFIRMED;

/**
 * Payment steps. These are driven by the payment record rather than by a user
 * pressing a "next" button, so they are modelled separately from the
 * professional/customer lifecycle above.
 */
export const PAYMENT_LIFECYCLE_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.PAYMENT_PENDING,
  BOOKING_STATUSES.PAID,
  BOOKING_STATUSES.CLOSED,
] as const;

export type PaymentLifecycleStatus = (typeof PAYMENT_LIFECYCLE_STATUSES)[number];

/**
 * Booking statuses a customer may still act on directly (confirm completion,
 * start payment). Derived, so it follows the sequence automatically.
 */
export const CUSTOMER_ACTIONABLE_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.PAYMENT_PENDING,
];

/** Narrows an untrusted value to a professional-owned lifecycle step. */
export function isProfessionalLifecycleStatus(value: string): value is ProfessionalLifecycleStatus {
  return (PROFESSIONAL_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

/** The status that may follow `current`, or `null` if the flow has ended. */
export function nextBookingLifecycleStatus(current: BookingStatus): BookingStatus | null {
  const index = BOOKING_LIFECYCLE.indexOf(current);
  if (index < 0 || index === BOOKING_LIFECYCLE.length - 1) return null;
  return BOOKING_LIFECYCLE[index + 1] ?? null;
}

/** The status a destination must currently be in to be reached, or `null`. */
export function previousBookingLifecycleStatus(next: BookingStatus): BookingStatus | null {
  const index = BOOKING_LIFECYCLE.indexOf(next);
  if (index <= 0) return null;
  return BOOKING_LIFECYCLE[index - 1] ?? null;
}

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const PAYMENT_METHODS = {
  ONLINE: 'ONLINE',
  DIRECT: 'DIRECT',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

/**
 * A review is written `PENDING` and only becomes visible on a professional's
 * profile once it is `PUBLISHED`. Nothing renders a non-published review.
 */
export const REVIEW_STATUSES = {
  PENDING: 'PENDING',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
} as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[keyof typeof REVIEW_STATUSES];

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;

export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

export const ADDRESS_TYPES = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;

export type AddressType = (typeof ADDRESS_TYPES)[keyof typeof ADDRESS_TYPES];

export const NOTIFICATION_TYPES = {
  BOOKING_REQUESTED: 'BOOKING_REQUESTED',
  BOOKING_ACCEPTED: 'BOOKING_ACCEPTED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  BOOKING_SCHEDULED: 'BOOKING_SCHEDULED',
  BOOKING_ON_THE_WAY: 'BOOKING_ON_THE_WAY',
  BOOKING_IN_PROGRESS: 'BOOKING_IN_PROGRESS',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_PAID: 'PAYMENT_PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  VERIFICATION_DECISION: 'VERIFICATION_DECISION',
  SYSTEM: 'SYSTEM',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Statuses that mean a service is actively under way. A customer may see the
 * assigned professional's shared location only while a booking is in one of
 * these states.
 */
export const ACTIVE_JOB_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.SCHEDULED,
  BOOKING_STATUSES.ON_THE_WAY,
  BOOKING_STATUSES.IN_PROGRESS,
];

export const PROFESSIONAL_VERIFICATION_STATUSES = {
  UNVERIFIED: 'UNVERIFIED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type ProfessionalVerificationStatus =
  (typeof PROFESSIONAL_VERIFICATION_STATUSES)[keyof typeof PROFESSIONAL_VERIFICATION_STATUSES];

export const ADMIN_AUDIT_ACTIONS = {
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  PROFESSIONAL_VERIFIED: 'PROFESSIONAL_VERIFIED',
  PROFESSIONAL_REJECTED: 'PROFESSIONAL_REJECTED',
  BOOKING_MODIFIED: 'BOOKING_MODIFIED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  REVIEW_MODERATED: 'REVIEW_MODATED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];

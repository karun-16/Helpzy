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

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;

export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

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

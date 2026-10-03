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
  RESCHEDULE_PENDING: 'RESCHEDULE_PENDING',
} as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];

/**
 * Statuses from which no further transition is allowed.
 *
 * `PAID` is deliberately not one of them. Settled is not finished: the customer can
 * still close the booking, and either party can still dispute it - a paid booking
 * that went badly is exactly the one a dispute has to be able to reach. Listing it
 * here made a paid booking a dead end, because every consumer of this constant
 * (dispute eligibility, the restore-on-resolution path, booking chat, the apps'
 * read-only flag) inherited that dead end along with it.
 */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
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
  DISPUTED: 'DISPUTED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const PAYMENT_METHODS = {
  ONLINE: 'ONLINE',
  DIRECT: 'DIRECT',
  CASH: 'CASH',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

/**
 * A proposed new appointment time.
 *
 * A proposal is never edited after it is raised: it is accepted, rejected or
 * withdrawn, so the full history of every schedule change is preserved.
 */
export const RESCHEDULE_STATUSES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;

export type RescheduleStatus = (typeof RESCHEDULE_STATUSES)[keyof typeof RESCHEDULE_STATUSES];

/**
 * Booking statuses a reschedule may be proposed from.
 *
 * A job that is already under way cannot simply be moved, so this deliberately
 * stops before `ON_THE_WAY`: once the professional is travelling the schedule is
 * a fact, not a proposal.
 */
export const RESCHEDULABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.REQUESTED,
  BOOKING_STATUSES.ACCEPTED,
  BOOKING_STATUSES.SCHEDULED,
  BOOKING_STATUSES.IN_PROGRESS,
];

/** Documents a professional can submit to be verified. */
export const VERIFICATION_DOCUMENT_TYPES = {
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  GST_CERTIFICATE: 'GST_CERTIFICATE',
  BUSINESS_LICENCE: 'BUSINESS_LICENCE',
  INSURANCE: 'INSURANCE',
  OTHER: 'OTHER',
} as const;

export type VerificationDocumentType =
  (typeof VERIFICATION_DOCUMENT_TYPES)[keyof typeof VERIFICATION_DOCUMENT_TYPES];

export const VERIFICATION_DOCUMENT_STATUSES = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type VerificationDocumentStatus =
  (typeof VERIFICATION_DOCUMENT_STATUSES)[keyof typeof VERIFICATION_DOCUMENT_STATUSES];

/** Instruments an online gateway can present. */
export const GATEWAY_METHODS = {
  UPI: 'UPI',
  DEBIT_CARD: 'DEBIT_CARD',
  CREDIT_CARD: 'CREDIT_CARD',
  NET_BANKING: 'NET_BANKING',
} as const;

export type GatewayMethod = (typeof GATEWAY_METHODS)[keyof typeof GATEWAY_METHODS];

/**
 * The document types a professional must submit before their verification can be
 * approved. Kept here rather than in the app so the admin queue and the
 * professional's checklist cannot disagree about what is required.
 */
export const REQUIRED_VERIFICATION_DOCUMENT_TYPES: readonly VerificationDocumentType[] = [
  VERIFICATION_DOCUMENT_TYPES.AADHAAR,
  VERIFICATION_DOCUMENT_TYPES.PAN,
];

/**
 * Whether a cash payment has been agreed by both parties.
 *
 * Deliberately a pure function of the two confirmation timestamps: the booking
 * must never be settled on one side's claim alone, so this is the single place
 * that decides whether cash counts as received.
 */
export function isCashFullyConfirmed(input: {
  customerConfirmedAt: Date | string | null;
  professionalConfirmedAt: Date | string | null;
}): boolean {
  return Boolean(input.customerConfirmedAt) && Boolean(input.professionalConfirmedAt);
}

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

/**
 * Where a service listing sits in moderation.
 *
 * `PENDING` is a freshly submitted listing awaiting an admin decision
 * while the platform requires moderation before publish. `APPROVED` is
 * a listing an admin has cleared - and, because it is the column
 * default, every listing that predates moderation. `REJECTED` is a
 * listing an admin has withdrawn, with the reason on `moderationNote`.
 *
 * A listing only reaches customers once it is both `APPROVED` and
 * `isActive`; the professional's own hide toggle can only move
 * `isActive` while the listing is `APPROVED`.
 */
export const SERVICE_MODERATION_STATUSES = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ServiceModerationStatus =
  (typeof SERVICE_MODERATION_STATUSES)[keyof typeof SERVICE_MODERATION_STATUSES];

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
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_RESCHEDULE_REQUESTED: 'BOOKING_RESCHEDULE_REQUESTED',
  BOOKING_RESCHEDULE_ACCEPTED: 'BOOKING_RESCHEDULE_ACCEPTED',
  BOOKING_RESCHEDULE_REJECTED: 'BOOKING_RESCHEDULE_REJECTED',
  /**
   * The proposer took the request back.
   *
   * A distinct value rather than reusing REJECTED: the recipient is the *other*
   * party, and telling them a request they were asked to answer was "declined"
   * reads as the other side refusing it. Nobody was refused; the ask was
   * withdrawn.
   */
  BOOKING_RESCHEDULE_WITHDRAWN: 'BOOKING_RESCHEDULE_WITHDRAWN',
  COMPLETION_AWAITING_CUSTOMER: 'COMPLETION_AWAITING_CUSTOMER',
  COMPLETION_AWAITING_PROFESSIONAL: 'COMPLETION_AWAITING_PROFESSIONAL',
  PAYMENT_METHOD_SELECTED: 'PAYMENT_METHOD_SELECTED',
  PAYMENT_AWAITING_BOTH: 'PAYMENT_AWAITING_BOTH',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  VERIFICATION_DECISION: 'VERIFICATION_DECISION',
  DISPUTE_OPENED: 'DISPUTE_OPENED',
  DISPUTE_UPDATED: 'DISPUTE_UPDATED',
  DISPUTE_RESOLVED: 'DISPUTE_RESOLVED',
  REPORT_FILED_ABOUT_YOU: 'REPORT_FILED_ABOUT_YOU',
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
  REVIEW_MODERATED: 'REVIEW_MODERATED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  CATEGORY_STATUS_CHANGED: 'CATEGORY_STATUS_CHANGED',
  SERVICE_MODERATED: 'SERVICE_MODERATED',
  REPORT_RESOLVED: 'REPORT_RESOLVED',
  DISPUTE_STATUS_CHANGED: 'DISPUTE_STATUS_CHANGED',
  VERIFICATION_DOCUMENT_REVIEWED: 'VERIFICATION_DOCUMENT_REVIEWED',
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];

/* ------------------------------------------------------------- reporting */

/**
 * What a report can be about.
 *
 * A report names a target by id rather than by relation, because the same
 * complaint covers very different rows and a polymorphic link is the only way to
 * keep one submission path. `targetId` is validated against `targetType` by the
 * reporting service, so a mistyped id fails loudly instead of filing a report
 * against nothing.
 */
export const REPORT_TARGET_TYPES = {
  PROFESSIONAL: 'PROFESSIONAL',
  SERVICE: 'SERVICE',
  BOOKING: 'BOOKING',
  REVIEW: 'REVIEW',
} as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[keyof typeof REPORT_TARGET_TYPES];

/**
 * Reasons a report can be filed for.
 *
 * These drive the admin's triage, so the list is deliberately short: a free-text
 * description carries the detail, and a narrow reason list is what makes
 * filtering and prioritisation possible.
 */
export const REPORT_REASONS = {
  INAPPROPRIATE_CONTENT: 'INAPPROPRIATE_CONTENT',
  FRAUD_OR_SCAM: 'FRAUD_OR_SCAM',
  HARASSMENT: 'HARASSMENT',
  MISLEADING_LISTING: 'MISLEADING_LISTING',
  UNSAFE_OR_UNPROFESSIONAL: 'UNSAFE_OR_UNPROFESSIONAL',
  NO_SHOW: 'NO_SHOW',
  PAYMENT_ISSUE: 'PAYMENT_ISSUE',
  OTHER: 'OTHER',
} as const;

export type ReportReason = (typeof REPORT_REASONS)[keyof typeof REPORT_REASONS];

/**
 * Report lifecycle.
 *
 * `OPEN` is a freshly filed report nobody has looked at, `UNDER_REVIEW` is one an
 * admin has actively picked up, and the two terminal states say what was
 * decided. A report is never deleted, so the decision history survives.
 */
export const REPORT_STATUSES = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;

export type ReportStatus = (typeof REPORT_STATUSES)[keyof typeof REPORT_STATUSES];

export const TERMINAL_REPORT_STATUSES: readonly ReportStatus[] = [
  REPORT_STATUSES.RESOLVED,
  REPORT_STATUSES.DISMISSED,
];

/* ------------------------------------------------------------- disputes */

/** What a dispute is about. */
export const DISPUTE_CATEGORIES = {
  SERVICE_NOT_AS_DESCRIBED: 'SERVICE_NOT_AS_DESCRIBED',
  NO_SHOW: 'NO_SHOW',
  QUALITY_ISSUE: 'QUALITY_ISSUE',
  PROPERTY_DAMAGE: 'PROPERTY_DAMAGE',
  PAYMENT_ISSUE: 'PAYMENT_ISSUE',
  UNSAFE_BEHAVIOUR: 'UNSAFE_BEHAVIOUR',
  OTHER: 'OTHER',
} as const;

export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[keyof typeof DISPUTE_CATEGORIES];

/**
 * Dispute lifecycle.
 *
 * A dispute is bound to one booking, so it opens and closes alongside that
 * booking's `DISPUTED` state and can never outlive the work it is about.
 */
export const DISPUTE_STATUSES = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[keyof typeof DISPUTE_STATUSES];

export const TERMINAL_DISPUTE_STATUSES: readonly DisputeStatus[] = [
  DISPUTE_STATUSES.RESOLVED,
  DISPUTE_STATUSES.REJECTED,
];

/**
 * One entry in a dispute's history. Everything about a dispute is append-only:
 * the opening post, the messages between the parties and the platform, and every
 * status change are all rows, so an admin resolving it can see what they saw.
 */
export const DISPUTE_EVENT_TYPES = {
  OPENED: 'OPENED',
  MESSAGE: 'MESSAGE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  RESOLUTION: 'RESOLUTION',
} as const;

export type DisputeEventType = (typeof DISPUTE_EVENT_TYPES)[keyof typeof DISPUTE_EVENT_TYPES];

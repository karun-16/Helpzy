import { z } from 'zod';
import {
  ADDRESS_TYPES,
  BOOKING_STATUSES,
  DISPUTE_CATEGORIES,
  DISPUTE_EVENT_TYPES,
  DISPUTE_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROFESSIONAL_VERIFICATION_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  RESCHEDULE_STATUSES,
  SERVICE_MODERATION_STATUSES,
  USER_STATUSES,
  REVIEW_STATUSES,
  VERIFICATION_DOCUMENT_STATUSES,
  VERIFICATION_DOCUMENT_TYPES,
  GATEWAY_METHODS,
  type AddressType,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@helpzy/types';

import { marketplaceLocationSlugSchema } from './primitives';

/* ------------------------------------------------------------------ shared */

const isoDateTime = z.string().datetime({ offset: true });
const nullableDateTime = isoDateTime.nullable();

const addressInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  type: z.enum(ADDRESS_TYPES).default('OTHER'),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(20),
  isDefault: z.boolean().optional(),
});

const workingHourSchema = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
});

/* --------------------------------------------------------------- addresses */

export const customerAddressSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  type: z.enum(ADDRESS_TYPES),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  isDefault: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const customerAddressesSchema = z.array(customerAddressSchema);
export const upsertCustomerAddressSchema = addressInputSchema;
export type UpsertCustomerAddressDto = z.infer<typeof upsertCustomerAddressSchema>;
export type CustomerAddressDto = z.infer<typeof customerAddressSchema>;

/* -------------------------------------------------------- customer profile */

export const customerProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  memberSince: isoDateTime,
  bookingCount: z.number().int().nonnegative(),
  addressCount: z.number().int().nonnegative(),
});
export type CustomerProfileDto = z.infer<typeof customerProfileSchema>;

export const updateCustomerProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    avatarUrl: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type UpdateCustomerProfileDto = z.infer<typeof updateCustomerProfileSchema>;

/* ----------------------------------------------------- professional profile */

export const workingHoursSchema = z.array(workingHourSchema).max(7);

export const professionalServiceOfferingSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string().nullable(),
  description: z.string(),
  priceAmount: z.number().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive(),
  category: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() }),
});

export const professionalReviewSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  customerName: z.string(),
  serviceTitle: z.string(),
  createdAt: isoDateTime,
});

export const marketplaceLocationSchema = z.object({
  slug: z.string(),
  state: z.string(),
  district: z.string(),
  city: z.string(),
});
export type MarketplaceLocationDto = z.infer<typeof marketplaceLocationSchema>;

export const professionalMarketplaceProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  businessName: z.string(),
  bio: z.string().nullable(),
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  verificationNote: z.string().nullable().optional(),
  serviceArea: z.string().nullable(),
  location: marketplaceLocationSchema.nullable(),
  avatarUrl: z.string().nullable(),
  contactEmail: z.string().nullable().optional(),
  phone: z.string().optional(),
  yearsOfExperience: z.number().int().nonnegative().optional(),
  workingHours: workingHoursSchema.optional(),
  completedCount: z.number().int().nonnegative(),
  averageRating: z.number().nonnegative().optional(),
  ratingCount: z.number().int().nonnegative().optional(),
  reviews: z.array(professionalReviewSchema).default([]),
  services: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      summary: z.string().nullable(),
      category: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() }),
    }),
  ),
  offerings: z.array(professionalServiceOfferingSchema).default([]),
});
export type ProfessionalMarketplaceProfileDto = z.infer<
  typeof professionalMarketplaceProfileSchema
>;

export const professionalOwnProfileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  businessName: z.string(),
  bio: z.string().nullable(),
  serviceArea: z.string().nullable(),
  location: marketplaceLocationSchema.nullable(),
  contactEmail: z.string().nullable(),
  isPhoneVisible: z.boolean(),
  yearsOfExperience: z.number().int().nonnegative().nullable(),
  workingHours: workingHoursSchema,
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  verifiedAt: nullableDateTime,
  rejectionNote: z.string().nullable(),
  isLocationSharingEnabled: z.boolean(),
  completedCount: z.number().int().nonnegative(),
  averageRating: z.number().nonnegative(),
  ratingCount: z.number().int().nonnegative(),
});
export type ProfessionalOwnProfileDto = z.infer<typeof professionalOwnProfileSchema>;

/**
 * Note the absence of `role` and `verification`: a professional may never set
 * their own role or claim verification.
 */
export const updateProfessionalProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    avatarUrl: z.string().trim().max(500).nullable().optional(),
    businessName: z.string().trim().min(2).max(160).optional(),
    bio: z.string().trim().max(4000).nullable().optional(),
    serviceArea: z.string().trim().max(200).nullable().optional(),
    /** `null` clears the location and returns the professional to no marketplace. */
    locationSlug: marketplaceLocationSlugSchema.nullable().optional(),
    contactEmail: z.string().trim().email().max(200).nullable().optional(),
    isPhoneVisible: z.boolean().optional(),
    yearsOfExperience: z.number().int().min(0).max(80).nullable().optional(),
    workingHours: workingHoursSchema.optional(),
    isLocationSharingEnabled: z.boolean().optional(),
  })
  .strict();
export type UpdateProfessionalProfileDto = z.infer<typeof updateProfessionalProfileSchema>;

export const professionalLocationUpdateSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
export type ProfessionalLocationUpdateDto = z.infer<typeof professionalLocationUpdateSchema>;

/**
 * The assigned professional's last reported position for one booking.
 *
 * Modelled as an explicit union rather than a nullable blob so a client cannot
 * render "sharing is off" and "the device has not reported yet" the same way, and
 * so there is no representation for a position nobody reported.
 */
export const assignedProfessionalLocationSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.enum(['SHARING_DISABLED', 'BOOKING_NOT_ACTIVE', 'NO_REPORTED_POSITION']),
    professionalName: z.string(),
    bookingReference: z.string(),
    latitude: z.null(),
    longitude: z.null(),
    updatedAt: z.null(),
    isStale: z.null(),
  }),
  z.object({
    available: z.literal(true),
    reason: z.null(),
    professionalName: z.string(),
    bookingReference: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    updatedAt: isoDateTime,
    /** True when the fix is older than the configured staleness window. */
    isStale: z.boolean(),
  }),
]);
export type AssignedProfessionalLocationDto = z.infer<typeof assignedProfessionalLocationSchema>;

/* --------------------------------------------------------- booking timeline */

/**
 * One recorded status transition.
 *
 * These rows are written inside the same transaction as the status change, so a
 * timeline can never show an event the booking did not actually go through, and
 * it can never omit one it did. Nothing is generated on read.
 */
export const bookingTimelineEntrySchema = z.object({
  id: z.string().uuid(),
  fromStatus: z.enum(BOOKING_STATUSES).nullable(),
  toStatus: z.enum(BOOKING_STATUSES),
  actorName: z.string(),
  /** True when the signed-in participant performed this step. */
  isOwnAction: z.boolean(),
  createdAt: isoDateTime,
});
export const bookingTimelineSchema = z.array(bookingTimelineEntrySchema);
export type BookingTimelineEntryDto = z.infer<typeof bookingTimelineEntrySchema>;

/* ------------------------------------------------- professional own services */

export const professionalCategoryOptionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});
export const professionalCategoryOptionsSchema = z.array(professionalCategoryOptionSchema);
export type ProfessionalCategoryOptionDto = z.infer<typeof professionalCategoryOptionSchema>;

export const professionalServiceRecordSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  description: z.string(),
  priceAmount: z.number().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive(),
  isActive: z.boolean(),
  /**
   * Where the listing sits in moderation. A listing the platform
   * requires review for reads `PENDING` until an admin clears it,
   * so the professional can tell "hidden for review" apart from
   * "hidden by me" and from "withdrawn".
   */
  moderationStatus: z.enum(SERVICE_MODERATION_STATUSES),
  /**
   * Present only while an admin has withdrawn the listing. The professional sees
   * it so a hidden service is never a silent mystery.
   */
  moderationNote: z.string().nullable(),
  category: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() }),
  bookingCount: z.number().int().nonnegative(),
});
export const professionalServicesSchema = z.array(professionalServiceRecordSchema);
export type ProfessionalServiceRecordDto = z.infer<typeof professionalServiceRecordSchema>;

export const createProfessionalServiceSchema = z
  .object({
    categoryId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().min(10).max(4000),
    priceAmount: z.number().positive().max(10_000_000),
    currency: z.string().trim().length(3).default('INR'),
    durationMinutes: z.number().int().min(15).max(1440),
  })
  .strict();
export type CreateProfessionalServiceDto = z.infer<typeof createProfessionalServiceSchema>;

export const updateProfessionalServiceSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    summary: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().min(10).max(4000).optional(),
    priceAmount: z.number().positive().max(10_000_000).optional(),
    durationMinutes: z.number().int().min(15).max(1440).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateProfessionalServiceDto = z.infer<typeof updateProfessionalServiceSchema>;

/* ----------------------------------------------------------- notifications */

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  bookingId: z.string().uuid().nullable(),
  readAt: nullableDateTime,
  createdAt: isoDateTime,
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationSummarySchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationSummaryDto = z.infer<typeof notificationSummarySchema>;

/* -------------------------------------------------------------------- chat */
export const bookingMessageSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  /** True when the signed-in user sent this, so the client can align the bubble. */
  isOwn: z.boolean(),
  body: z.string(),
  readAt: nullableDateTime,
  createdAt: isoDateTime,
  senderName: z.string(),
});

export const bookingMessagesSchema = z.array(bookingMessageSchema);
export type BookingMessageDto = z.infer<typeof bookingMessageSchema>;
export type BookingMessagesDto = z.infer<typeof bookingMessagesSchema>;

export const sendBookingMessageSchema = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export type SendBookingMessageDto = z.infer<typeof sendBookingMessageSchema>;

/* ------------------------------------------------------------- reschedule */

export const requestRescheduleSchema = z
  .object({
    proposedStart: isoDateTime,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type RequestRescheduleDto = z.infer<typeof requestRescheduleSchema>;

/**
 * A decision on someone else's proposal. A rejection must say why: an
 * unexplained "no" leaves the proposer with nothing to act on.
 */
export const decideRescheduleSchema = z
  .object({
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    decisionNote: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.decision !== 'REJECTED' || Boolean(value.decisionNote), {
    message: 'Please say why the new time does not work.',
    path: ['decisionNote'],
  });
export type DecideRescheduleDto = z.infer<typeof decideRescheduleSchema>;

export const rescheduleRequestSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string(),
  requestedById: z.string().uuid(),
  requestedByName: z.string(),
  requestedByRole: z.enum(['CUSTOMER', 'PROFESSIONAL']),
  previousStart: isoDateTime,
  previousEnd: isoDateTime,
  proposedStart: isoDateTime,
  proposedEnd: isoDateTime,
  reason: z.string().nullable(),
  status: z.enum(RESCHEDULE_STATUSES),
  decisionNote: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: nullableDateTime,
  createdAt: isoDateTime,
});
export type RescheduleRequestDto = z.infer<typeof rescheduleRequestSchema>;

export const rescheduleRequestsSchema = z.array(rescheduleRequestSchema);
export type RescheduleRequestsDto = z.infer<typeof rescheduleRequestsSchema>;

/**
 * What each party can do about a pending proposal, resolved server-side so the
 * app never has to re-derive the rule and get it wrong.
 */
export const rescheduleStateSchema = z.object({
  /** The live proposal, if the booking is waiting on a decision. */
  pending: rescheduleRequestSchema.nullable(),
  canRequest: z.boolean(),
  canDecide: z.boolean(),
  canWithdraw: z.boolean(),
});
export type RescheduleStateDto = z.infer<typeof rescheduleStateSchema>;

/* --------------------------------------------------- completion (mutual) */

/**
 * Either party records that the work is done. The first confirmation only moves
 * the booking to a pending state; the second completes it.
 */
export const markCompletedSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type MarkCompletedDto = z.infer<typeof markCompletedSchema>;

/** Who has confirmed completion, and when. Drives both dashboards. */
export const completionStateSchema = z.object({
  status: z.string(),
  professionalConfirmedAt: nullableDateTime,
  professionalConfirmedByName: z.string().nullable(),
  customerConfirmedAt: nullableDateTime,
  customerConfirmedByName: z.string().nullable(),
  isComplete: z.boolean(),
  /** True when the viewer still has their own confirmation to give. */
  awaitingViewerConfirmation: z.boolean(),
});
export type CompletionStateDto = z.infer<typeof completionStateSchema>;

/* ---------------------------------------------------------------- payment */

/**
 * A cash payment's two independent confirmations.
 *
 * `isSettled` is derived server-side from both confirmations, so the client can
 * never conclude from a single response that cash was received. Declared above
 * the payment schemas that embed it.
 */
export const cashConfirmationSchema = z.object({
  customerConfirmedAt: nullableDateTime,
  customerConfirmedByName: z.string().nullable(),
  professionalConfirmedAt: nullableDateTime,
  professionalConfirmedByName: z.string().nullable(),
  isSettled: z.boolean(),
  awaitingViewerConfirmation: z.boolean(),
});
export type CashConfirmationDto = z.infer<typeof cashConfirmationSchema>;

export const bookingPaymentSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string(),
  method: z.enum(PAYMENT_METHODS).nullable(),
  status: z.enum(PAYMENT_STATUSES),
  provider: z.string().nullable(),
  failureReason: z.string().nullable(),
  paidAt: nullableDateTime,
  createdAt: isoDateTime,
  /**
   * True only when a verified gateway callback settled this payment. A payment a
   * party merely claimed is recorded but never verified, and the app shows the
   * difference rather than presenting both as "paid".
   */
  gatewayVerified: z.boolean(),
  gatewayTransactionId: z.string().nullable(),
  gatewayMethod: z.string().nullable(),
  /** Only present for a cash payment, which needs two confirmations. */
  cash: cashConfirmationSchema.nullable(),
});
export type BookingPaymentDto = z.infer<typeof bookingPaymentSchema>;

/** The professional's view: the money is theirs, but they cannot change it here. */
export const professionalPaymentSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string(),
  method: z.enum(PAYMENT_METHODS).nullable(),
  status: z.enum(PAYMENT_STATUSES),
  paidAt: nullableDateTime,
  gatewayVerified: z.boolean(),
  gatewayTransactionId: z.string().nullable(),
  cash: cashConfirmationSchema.nullable(),
});
export type ProfessionalPaymentDto = z.infer<typeof professionalPaymentSchema>;

export const paymentCapabilitySchema = z.object({
  onlineAvailable: z.boolean(),
  directAvailable: z.literal(true),
  /** Cash needs no provider at all, so it is always available. */
  cashAvailable: z.literal(true),
  providerName: z.string().nullable(),
});
export type PaymentCapabilityDto = z.infer<typeof paymentCapabilitySchema>;

/**
 * A customer chooses a method; the server decides the outcome. There is no
 * "mark as paid" flag in this payload by design.
 */
export const startPaymentSchema = z.object({ method: z.enum(PAYMENT_METHODS) }).strict();
export type StartPaymentDto = z.infer<typeof startPaymentSchema>;

/** Recorded by the professional when the customer pays them directly. */
export const recordDirectPaymentSchema = z
  .object({
    received: z.literal(true),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type RecordDirectPaymentDto = z.infer<typeof recordDirectPaymentSchema>;

/**
 * Either party confirms a cash handover.
 *
 * There is no `amount` and no "mark as paid": confirming only records that this
 * party agrees the money changed hands, and the payment settles when both have
 * confirmed.
 */
export const confirmCashPaymentSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ConfirmCashPaymentDto = z.infer<typeof confirmCashPaymentSchema>;

/** A customer opens gateway checkout for a chosen instrument. */
export const startGatewayCheckoutSchema = z
  .object({
    method: z.enum(GATEWAY_METHODS),
  })
  .strict();
export type StartGatewayCheckoutDto = z.infer<typeof startGatewayCheckoutSchema>;

/**
 * What the gateway checkout needs, plus everything the app must not decide.
 *
 * `verified` is always false in a checkout response: only a verified callback
 * can set a payment paid, never the app returning from a redirect.
 */
export const gatewayCheckoutSchema = z.object({
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string(),
  provider: z.string(),
  /** Where the customer completes payment. Opaque to the client. */
  checkoutUrl: z.string(),
  /** The gateway's own reference for this attempt. */
  gatewayTransactionId: z.string(),
  instrument: z.enum(GATEWAY_METHODS),
  amount: z.number().nonnegative(),
  currency: z.string(),
  expiresAt: isoDateTime,
  verified: z.literal(false),
});
export type GatewayCheckoutDto = z.infer<typeof gatewayCheckoutSchema>;

export const gatewayCapabilitySchema = z.object({
  onlineAvailable: z.boolean(),
  providerName: z.string().nullable(),
  /** Only the instruments this deployment's provider actually offers. */
  methods: z.array(z.enum(GATEWAY_METHODS)),
});
export type GatewayCapabilityDto = z.infer<typeof gatewayCapabilitySchema>;

/** One recorded interaction with the payment provider. Append-only. */
export const paymentAttemptSchema = z.object({
  id: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_STATUSES),
  provider: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTime,
});
export type PaymentAttemptDto = z.infer<typeof paymentAttemptSchema>;

export const paymentHistorySchema = z.object({
  payment: bookingPaymentSchema.nullable(),
  attempts: z.array(paymentAttemptSchema),
  cash: cashConfirmationSchema.nullable(),
  /** A gateway-settled payment is distinguishable from a merely recorded one. */
  gatewayVerified: z.boolean(),
  gatewayTransactionId: z.string().nullable(),
});
export type PaymentHistoryDto = z.infer<typeof paymentHistorySchema>;

/* --------------------------------------------- verification documents */

export const verificationDocumentTypesSchema = z.enum(VERIFICATION_DOCUMENT_TYPES);

/**
 * A document upload.
 *
 * `data` is base64, matching the existing profile-photo path so the app needs no
 * second upload mechanism. The filename is metadata only and is never used to
 * build a storage path.
 */
export const uploadVerificationDocumentSchema = z
  .object({
    type: verificationDocumentTypesSchema,
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
    data: z.string().min(1),
    originalName: z.string().trim().max(255).optional(),
  })
  .strict();
export type UploadVerificationDocumentDto = z.infer<typeof uploadVerificationDocumentSchema>;

export const verificationDocumentReviewEntrySchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(VERIFICATION_DOCUMENT_STATUSES),
  note: z.string().nullable(),
  reviewerName: z.string(),
  createdAt: isoDateTime,
});
export type VerificationDocumentReviewEntryDto = z.infer<
  typeof verificationDocumentReviewEntrySchema
>;

export const verificationDocumentSchema = z.object({
  id: z.string().uuid(),
  professionalId: z.string().uuid(),
  type: z.enum(VERIFICATION_DOCUMENT_TYPES),
  status: z.enum(VERIFICATION_DOCUMENT_STATUSES),
  contentType: z.string(),
  byteSize: z.number().int(),
  originalName: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  submittedAt: isoDateTime,
  reviewedAt: nullableDateTime,
  reviewedByName: z.string().nullable(),
  reviews: z.array(verificationDocumentReviewEntrySchema),
});
export type VerificationDocumentDto = z.infer<typeof verificationDocumentSchema>;

export const verificationDocumentsSchema = z.array(verificationDocumentSchema);
export type VerificationDocumentsDto = z.infer<typeof verificationDocumentsSchema>;

/**
 * A rejection must say why, so the professional can actually fix the problem.
 * Uploading a document never verifies anybody - only this decision does.
 */
export const reviewVerificationDocumentSchema = z
  .object({
    decision: z.enum([
      VERIFICATION_DOCUMENT_STATUSES.APPROVED,
      VERIFICATION_DOCUMENT_STATUSES.REJECTED,
    ]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (value) => value.decision !== VERIFICATION_DOCUMENT_STATUSES.REJECTED || Boolean(value.note),
    { message: 'Please say why this document was rejected.', path: ['note'] },
  );
export type ReviewVerificationDocumentDto = z.infer<typeof reviewVerificationDocumentSchema>;

/** The owner's view: what is required, what is submitted, what is outstanding. */
export const verificationStatusSchema = z.object({
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  requiredTypes: z.array(verificationDocumentTypesSchema),
  documents: verificationDocumentsSchema,
  outstandingTypes: z.array(verificationDocumentTypesSchema),
});
export type VerificationStatusDto = z.infer<typeof verificationStatusSchema>;

/* ---------------------------------------------------------------- reviews */

export const createReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type CreateReviewDto = z.infer<typeof createReviewSchema>;

export const reviewSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']),
  customerName: z.string(),
  serviceTitle: z.string(),
  createdAt: isoDateTime,
});
export type ReviewDto = z.infer<typeof reviewSchema>;

export const reviewsSchema = z.array(reviewSchema);
export const professionalReviewsSchema = z.object({ reviews: reviewsSchema });
export type ProfessionalReviewsDto = z.infer<typeof professionalReviewsSchema>;

/* ------------------------------------------------------------------ admin */

export const adminUserSummarySchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  createdAt: isoDateTime,
});
export const adminUsersSchema = z.array(adminUserSummarySchema);
export type AdminUserSummaryDto = z.infer<typeof adminUserSummarySchema>;

export const adminProfessionalDetailSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  accountStatus: z.enum(USER_STATUSES),
  accountCreatedAt: isoDateTime,
  businessName: z.string(),
  bio: z.string().nullable(),
  serviceArea: z.string().nullable(),
  location: marketplaceLocationSchema.nullable(),
  contactEmail: z.string().nullable(),
  isPhoneVisible: z.boolean(),
  yearsOfExperience: z.number().int().nonnegative().nullable(),
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  verifiedAt: nullableDateTime,
  rejectionNote: z.string().nullable(),
  profileCreatedAt: isoDateTime,
  completedCount: z.number().int().nonnegative(),
  averageRating: z.number().nonnegative(),
  ratingCount: z.number().int().nonnegative(),
  services: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      description: z.string(),
      summary: z.string().nullable(),
      price: z.number().nonnegative(),
      currency: z.string(),
      active: z.boolean(),
      category: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
    }),
  ),
  bookings: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      status: z.enum(BOOKING_STATUSES),
      scheduledStart: isoDateTime,
      serviceTitle: z.string(),
      customerName: z.string(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: z.string().uuid(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().nullable(),
      status: z.enum(REVIEW_STATUSES),
      createdAt: isoDateTime,
      customerName: z.string(),
      serviceTitle: z.string(),
      bookingReference: z.string(),
    }),
  ),
});
export type AdminProfessionalDetailDto = z.infer<typeof adminProfessionalDetailSchema>;

export const adminBookingSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(BOOKING_STATUSES),
  scheduledStart: isoDateTime,
  createdAt: isoDateTime,
  amount: z.number().nonnegative(),
  currency: z.string(),
  serviceTitle: z.string(),
  customerName: z.string(),
  professionalName: z.string(),
  businessName: z.string(),
  paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
  reviewStatus: z.enum(REVIEW_STATUSES).nullable(),
});
export const adminBookingsSchema = z.array(adminBookingSchema);
export type AdminBookingDto = z.infer<typeof adminBookingSchema>;

export const adminVerificationRequestSchema = z.object({
  profileId: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  businessName: z.string(),
  bio: z.string().nullable(),
  serviceArea: z.string().nullable(),
  location: marketplaceLocationSchema.nullable(),
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  verifiedAt: nullableDateTime,
  rejectionNote: z.string().nullable(),
  /** Services the professional has actually published. */
  serviceCount: z.number().int().nonnegative(),
  /** Bookings this professional has actually taken. Never derived from the above. */
  bookingCount: z.number().int().nonnegative(),
  /**
   * The real services, so an admin reviews what will actually be published
   * rather than a count. Titles only - never a price the admin could mistake
   * for a verified quote.
   */
  services: z
    .array(z.object({ id: z.string().uuid(), title: z.string(), isActive: z.boolean() }))
    .default([]),
  /** Null when the professional has not stated it. Never defaulted to a number. */
  yearsOfExperience: z.number().int().nonnegative().nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  avatarUrl: z.string().nullable().default(null),
  submittedAt: isoDateTime,
});
export const adminVerificationRequestsSchema = z.array(adminVerificationRequestSchema);
export type AdminVerificationRequestDto = z.infer<typeof adminVerificationRequestSchema>;

export const adminVerificationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type AdminVerificationDecisionDto = z.infer<typeof adminVerificationDecisionSchema>;

export const adminAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actorName: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  createdAt: isoDateTime,
});
export const adminAuditLogSchema = z.array(adminAuditEntrySchema);
export type AdminAuditEntryDto = z.infer<typeof adminAuditEntrySchema>;

export const adminDashboardSummarySchema = z.object({
  users: z.object({
    total: z.number().int().nonnegative(),
    customers: z.number().int().nonnegative(),
    professionals: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
  }),
  bookings: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.record(z.enum(BOOKING_STATUSES), z.number().int().nonnegative()),
  }),
  payments: z.object({
    total: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  reviews: z.object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
  }),
  pendingVerifications: z.number().int().nonnegative(),
  unreadNotifications: z.number().int().nonnegative(),
});
export type AdminDashboardSummaryDto = z.infer<typeof adminDashboardSummarySchema>;

/* ------------------------------------------------------- admin categories */

/**
 * An admin's view of a marketplace category.
 *
 * `serviceCount` is live rather than cached, so the admin can judge whether
 * deactivating a category would hide real listings.
 */
export const adminCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  serviceCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const adminCategoriesSchema = z.array(adminCategorySchema);
export type AdminCategoryDto = z.infer<typeof adminCategorySchema>;

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;

/**
 * A category edit never accepts `slug` or `isActive`: the slug is derived from
 * the name so existing links keep resolving, and availability is changed through
 * the dedicated status endpoint so it stays auditable on its own.
 */
export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;

export const setCategoryStatusSchema = z
  .object({
    isActive: z.boolean(),
    /** Required when deactivating, so the audit trail explains the impact. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export type SetCategoryStatusDto = z.infer<typeof setCategoryStatusSchema>;

/* -------------------------------------------------- admin service moderation */

/**
 * A service as an admin sees it: the listing plus enough owner and category
 * context to judge whether it belongs on the marketplace at all.
 */
export const adminServiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  priceAmount: z.number().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive(),
  isActive: z.boolean(),
  /** Where the listing sits in moderation: pending review, approved or rejected. */
  moderationStatus: z.enum(SERVICE_MODERATION_STATUSES),
  moderationNote: z.string().nullable(),
  moderatedAt: nullableDateTime,
  bookingCount: z.number().int().nonnegative(),
  ratingCount: z.number().int().nonnegative(),
  averageRating: z.number().nonnegative(),
  createdAt: isoDateTime,
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  owner: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    phone: z.string(),
    status: z.string(),
    verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  }),
});
export const adminServicesSchema = z.array(adminServiceSchema);
export type AdminServiceDto = z.infer<typeof adminServiceSchema>;

/**
 * Withdrawing or restoring a listing always carries a reason.
 *
 * The note is stored on the service and shown to the professional, and it is
 * required even when restoring so the audit trail explains both directions.
 */
export const setServiceStatusSchema = z
  .object({
    isActive: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type SetServiceStatusDto = z.infer<typeof setServiceStatusSchema>;

/* ------------------------------------------------------ reports & disputes */

/**
 * Filing a report.
 *
 * `OTHER` deliberately still requires a description: the reason list is for
 * triage, not for replacing the account of what happened.
 */
export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: z.string().uuid(),
    reason: z.enum(REPORT_REASONS),
    description: z.string().trim().min(10).max(2000),
  })
  .strict();
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const reportSchema = z.object({
  id: z.string().uuid(),
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  description: z.string(),
  status: z.enum(REPORT_STATUSES),
  resolutionNote: z.string().nullable(),
  resolutionAction: z.string().nullable(),
  createdAt: isoDateTime,
  reporter: z.object({ id: z.string().uuid(), fullName: z.string() }),
  /** Resolved at filing time so triage is a single indexed lookup. */
  targetOwner: z.object({ id: z.string().uuid(), fullName: z.string() }),
  /** A short human label for the reported thing, e.g. the listing title. */
  targetLabel: z.string(),
});
export const reportsSchema = z.array(reportSchema);
export type ReportDto = z.infer<typeof reportSchema>;

/**
 * Closing a report. The note is mandatory because a report an admin closed
 * without saying anything leaves the person who filed it with no answer.
 */
export const resolveReportSchema = z
  .object({
    status: z.enum([REPORT_STATUSES.RESOLVED, REPORT_STATUSES.DISMISSED]),
    resolutionNote: z.string().trim().min(10).max(1000),
    resolutionAction: z.string().trim().min(2).max(100).optional(),
  })
  .strict();
export type ResolveReportDto = z.infer<typeof resolveReportSchema>;

/** Claiming a report for triage, without deciding it yet. */
export const startReportReviewSchema = z.object({}).strict();
export type StartReportReviewDto = z.infer<typeof startReportReviewSchema>;

export const openDisputeSchema = z
  .object({
    category: z.enum(DISPUTE_CATEGORIES),
    reason: z.string().trim().min(20).max(2000),
  })
  .strict();
export type OpenDisputeDto = z.infer<typeof openDisputeSchema>;

export const disputeEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(DISPUTE_EVENT_TYPES),
  body: z.string().nullable(),
  fromStatus: z.enum(DISPUTE_STATUSES).nullable(),
  toStatus: z.enum(DISPUTE_STATUSES).nullable(),
  createdAt: isoDateTime,
  actor: z.object({ id: z.string().uuid(), fullName: z.string(), role: z.string() }),
});
export type DisputeEventDto = z.infer<typeof disputeEventSchema>;

export const disputeSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  /** The booking's customer-facing reference, e.g. `HZ-1001`. */
  bookingReference: z.string(),
  category: z.enum(DISPUTE_CATEGORIES),
  reason: z.string(),
  status: z.enum(DISPUTE_STATUSES),
  resolutionNote: z.string().nullable(),
  createdAt: isoDateTime,
  resolvedAt: nullableDateTime,
  openedBy: z.object({ id: z.string().uuid(), fullName: z.string() }),
  against: z.object({ id: z.string().uuid(), fullName: z.string() }),
  bookingStatus: z.string(),
});
export const disputesSchema = z.array(disputeSchema);
export type DisputeDto = z.infer<typeof disputeSchema>;

export const disputeDetailSchema = disputeSchema.extend({
  events: z.array(disputeEventSchema),
});
export type DisputeDetailDto = z.infer<typeof disputeDetailSchema>;

export const disputeMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();
export type DisputeMessageDto = z.infer<typeof disputeMessageSchema>;

/**
 * An admin resolving or rejecting a dispute.
 *
 * Only the two terminal states are accepted here: moving a live dispute to
 * `UNDER_REVIEW` is a separate claim action, so an admin cannot skip triage and
 * land straight on an outcome.
 */
export const resolveDisputeSchema = z
  .object({
    status: z.enum([DISPUTE_STATUSES.RESOLVED, DISPUTE_STATUSES.REJECTED]),
    resolutionNote: z.string().trim().min(10).max(2000),
  })
  .strict();
export type ResolveDisputeDto = z.infer<typeof resolveDisputeSchema>;

/* ------------------------------------------------- admin booking oversight */

/** One entry in a booking's status timeline, as an admin sees it. */
export const adminBookingEventSchema = z.object({
  id: z.string().uuid(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  createdAt: isoDateTime,
  actor: z.object({ id: z.string().uuid(), fullName: z.string() }),
  /** Set when the change was an admin override rather than the normal flow. */
  isOverride: z.boolean(),
});

/**
 * Everything about one booking, gathered for an admin.
 *
 * The professional's phone number is included deliberately: when a booking has
 * gone wrong the first thing support needs is to be able to call somebody, and
 * `isPhoneVisible` governs what customers may see, not what an administrator may.
 */
export const adminBookingDetailSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.string(),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  priceAmount: z.number().nonnegative(),
  currency: z.string(),
  customerNote: z.string().nullable(),
  cancellationNote: z.string().nullable(),
  createdAt: isoDateTime,
  completedAt: nullableDateTime,
  customer: z.object({ id: z.string().uuid(), fullName: z.string(), phone: z.string() }),
  professional: z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    fullName: z.string(),
    phone: z.string(),
    businessName: z.string(),
  }),
  service: z.object({ id: z.string().uuid(), title: z.string() }),
  address: z
    .object({
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
    })
    .nullable(),
  payment: z
    .object({
      status: z.string(),
      amount: z.number().nonnegative(),
      method: z.string(),
      failureReason: z.string().nullable(),
    })
    .nullable(),
  review: z.object({ id: z.string().uuid(), status: z.string(), rating: z.number() }).nullable(),
  dispute: z
    .object({
      id: z.string().uuid(),
      status: z.string(),
      category: z.string(),
      reason: z.string(),
    })
    .nullable(),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      body: z.string(),
      createdAt: isoDateTime,
      sender: z.object({ id: z.string().uuid(), fullName: z.string() }),
    }),
  ),
  timeline: z.array(adminBookingEventSchema),
});
export type AdminBookingDetailDto = z.infer<typeof adminBookingDetailSchema>;

/**
 * An admin overriding a booking's status.
 *
 * The reason is required because an override deliberately breaks the rule that
 * each status belongs to a particular actor; without a stated reason there is
 * no way to tell a legitimate intervention from a mistake afterwards.
 */
export const overrideBookingStatusSchema = z
  .object({
    status: z.enum(BOOKING_STATUSES),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export type OverrideBookingStatusDto = z.infer<typeof overrideBookingStatusSchema>;

export const refundBookingSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export type RefundBookingDto = z.infer<typeof refundBookingSchema>;

/* ---------------------------------------------------------- media uploads */

/**
 * Image formats accepted as a profile photo.
 *
 * One list, shared by the picker, the request validator and the server's
 * signature check, so widening what a person may upload cannot silently drift
 * away from what the server is willing to store.
 *
 * Every entry here is a format browsers actually render in an `<img>` and the
 * local media store serves with the right `Content-Type`. That pairing is the
 * whole point of the list: accepting a format that one end cannot display is
 * what produces a photo that saves and then never appears.
 *
 * HEIC/HEIF is deliberately absent. Safari renders it, Chrome and Firefox do
 * not, and transcoding it here would mean adding an image codec to the service.
 * It is refused by name instead of appearing in this list.
 */
export const PROFILE_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
] as const;
export type ProfileImageContentType = (typeof PROFILE_IMAGE_CONTENT_TYPES)[number];

/**
 * Formats that are refused by name rather than by "not in the list".
 *
 * The message matters: a person who picked a photo straight off a phone is
 * looking at a HEIC file and would otherwise read "unsupported image" as the app
 * being broken, rather than as their camera's file needing an export.
 */
export const HEIC_IMAGE_CONTENT_TYPES = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
] as const;

/** One-line, human-facing summary of what the picker accepts. */
export const PROFILE_IMAGE_FORMAT_SUMMARY = 'JPEG, PNG, WebP, GIF, BMP or AVIF';

export const mediaUploadSchema = z.object({
  kind: z.enum(['AVATAR']),
  publicUrl: z.string().url(),
  contentType: z.enum(PROFILE_IMAGE_CONTENT_TYPES),
  byteSize: z.number().int().positive(),
  provider: z.string(),
});
export type MediaUploadDto = z.infer<typeof mediaUploadSchema>;

export const mediaAssetSchema = z.object({
  kind: z.string(),
  publicUrl: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
});
export type MediaAssetDto = z.infer<typeof mediaAssetSchema>;

/* ------------------------------------------------------ extended bookings */

export const bookingStatusValue = z.enum(BOOKING_STATUSES);

export type { AddressType, BookingStatus, PaymentMethod, PaymentStatus };

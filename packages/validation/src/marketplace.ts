import { z } from 'zod';
import {
  ADDRESS_TYPES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROFESSIONAL_VERIFICATION_STATUSES,
  type AddressType,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@helpzy/types';

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

export const professionalMarketplaceProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  businessName: z.string(),
  bio: z.string().nullable(),
  verification: z.enum(PROFESSIONAL_VERIFICATION_STATUSES),
  verificationNote: z.string().nullable().optional(),
  serviceArea: z.string().nullable(),
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
    priceAmount: z.number().nonnegative().max(10_000_000),
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
    priceAmount: z.number().nonnegative().max(10_000_000).optional(),
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

/* ---------------------------------------------------------------- payment */

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
});
export type ProfessionalPaymentDto = z.infer<typeof professionalPaymentSchema>;

export const paymentCapabilitySchema = z.object({
  onlineAvailable: z.boolean(),
  directAvailable: z.literal(true),
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

export const adminVerificationRequestSchema = z.object({
  profileId: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  businessName: z.string(),
  bio: z.string().nullable(),
  serviceArea: z.string().nullable(),
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

/* ---------------------------------------------------------- media uploads */

export const mediaUploadSchema = z.object({
  kind: z.enum(['AVATAR']),
  publicUrl: z.string().url(),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
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

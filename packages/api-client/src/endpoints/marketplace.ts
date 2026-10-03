import {
  adminAuditEntrySchema,
  adminBookingDetailSchema,
  adminCategoriesSchema,
  adminCategorySchema,
  adminBookingsSchema,
  adminDashboardSummarySchema,
  disputeDetailSchema,
  disputesSchema,
  adminProfessionalDetailSchema,
  adminServiceSchema,
  adminServicesSchema,
  adminUserSummarySchema,
  adminVerificationDecisionSchema,
  adminVerificationRequestSchema,
  assignedProfessionalLocationSchema,
  bookingMessagesSchema,
  bookingPaymentSchema,
  confirmCashPaymentSchema,
  createCategorySchema,
  createProfessionalServiceSchema,
  customerAddressSchema,
  customerAddressesSchema,
  customerProfileSchema,
  mediaUploadSchema,
  notificationSummarySchema,
  paymentCapabilitySchema,
  professionalCategoryOptionsSchema,
  professionalJobsSchema,
  professionalOwnProfileSchema,
  professionalPaymentSchema,
  professionalReviewsSchema,
  professionalServiceRecordSchema,
  professionalServicesSchema,
  overrideBookingStatusSchema,
  platformSettingsResponseSchema,
  recordDirectPaymentSchema,
  refundBookingSchema,
  updatePlatformSettingsSchema,
  reportSchema,
  reportsSchema,
  resolveDisputeSchema,
  resolveReportSchema,
  reviewSchema,
  startReportReviewSchema,
  reviewsSchema,
  sendBookingMessageSchema,
  startPaymentSchema,
  setCategoryStatusSchema,
  setServiceStatusSchema,
  updateCategorySchema,
  updateCustomerProfileSchema,
  updateProfessionalProfileSchema,
  updateProfessionalServiceSchema,
  upsertCustomerAddressSchema,
  type AdminBookingDetailDto,
  type AdminBookingDto,
  type OverrideBookingStatusDto,
  type ProfileImageContentType,
  type RefundBookingDto,
  type UpdatePlatformSettings,
  type AdminCategoryDto,
  type AdminProfessionalDetailDto,
  type AdminServiceDto,
  type CreateReportDto,
  type DisputeDetailDto,
  type DisputeDto,
  type OpenDisputeDto,
  type ReportDto,
  type ResolveDisputeDto,
  type ResolveReportDto,
  type AdminUserSummaryDto,
  type AdminVerificationRequestDto,
  type CreateProfessionalServiceDto,
  type CreateCategoryDto,
  type CreateReviewDto,
  type CustomerAddressDto,
  type CustomerProfileDto,
  type NotificationDto,
  type PaymentCapabilityDto,
  type ProfessionalCategoryOptionDto,
  type ProfessionalOwnProfileDto,
  type ProfessionalPaymentDto,
  type ProfessionalServiceRecordDto,
  type ReviewDto,
  type SetCategoryStatusDto,
  type SetServiceStatusDto,
  type UpdateCategoryDto,
  type UpdateCustomerProfileDto,
  type UpdateProfessionalProfileDto,
  type UpdateProfessionalServiceDto,
  type UpsertCustomerAddressDto,
} from '@helpzy/validation';
import { z } from 'zod';

import type { HelpzyApiClient } from '../client';

/**
 * The customer's own account, address book and avatar.
 *
 * None of these take a user id: the API resolves the account from the session,
 * so there is nothing for a caller to get wrong or to forge.
 */
export function createCustomerAccountApi(client: HelpzyApiClient) {
  return {
    getProfile: (signal?: AbortSignal) =>
      client.get('customer/account/profile', { schema: customerProfileSchema, signal }),

    updateProfile: (input: UpdateCustomerProfileDto) =>
      client.patch('customer/account/profile', updateCustomerProfileSchema.parse(input), {
        schema: customerProfileSchema,
      }),

    uploadPhoto: (base64: string, contentType: ProfileImageContentType) =>
      client.post(
        'customer/account/profile/photo',
        { data: base64, contentType },
        {
          schema: mediaUploadSchema,
        },
      ),

    listAddresses: (signal?: AbortSignal) =>
      client.get('customer/account/addresses', { schema: customerAddressesSchema, signal }),

    createAddress: (input: UpsertCustomerAddressDto) =>
      client.post('customer/account/addresses', upsertCustomerAddressSchema.parse(input), {
        schema: customerAddressSchema,
      }),

    updateAddress: (addressId: string, input: UpsertCustomerAddressDto) =>
      client.patch(
        `customer/account/addresses/${encodeURIComponent(addressId)}`,
        upsertCustomerAddressSchema.parse(input),
        { schema: customerAddressSchema },
      ),

    setDefaultAddress: (addressId: string) =>
      client.patch(
        `customer/account/addresses/${encodeURIComponent(addressId)}/default`,
        undefined,
        {
          schema: customerAddressSchema,
        },
      ),

    deleteAddress: (addressId: string) =>
      client.delete(`customer/account/addresses/${encodeURIComponent(addressId)}`),
  };
}

export function createNotificationsApi(client: HelpzyApiClient) {
  return {
    /** Newest first, with the unread count for the signed-in user. */
    list: (signal?: AbortSignal) =>
      client.get('notifications', { schema: notificationSummarySchema, signal }),

    unreadCount: (signal?: AbortSignal) =>
      client.get('notifications/unread-count', {
        schema: z.object({ unreadCount: z.number().int().nonnegative() }),
        signal,
      }),

    markRead: (notificationId: string) =>
      client.patch(`notifications/${encodeURIComponent(notificationId)}/read`, undefined, {
        schema: z.object({ updated: z.number().int().nonnegative() }),
      }),

    markAllRead: () =>
      client.patch('notifications/read-all', undefined, {
        schema: z.object({ updated: z.number().int().nonnegative() }),
      }),
  };
}

/** "My Jobs": the professional's board, grouped by what they can act on. */
export function createProfessionalJobsApi(client: HelpzyApiClient) {
  return {
    list: (signal?: AbortSignal) =>
      client.get('professional/bookings/my-jobs', { schema: professionalJobsSchema, signal }),
  };
}

export function createPaymentsApi(client: HelpzyApiClient) {
  return {
    /**
     * What this deployment can actually do. The customer screen renders options
     * from this response, so an unconfigured gateway never shows a dead button.
     */
    capabilities: (signal?: AbortSignal) =>
      client.get('customer/payments/capabilities', { schema: paymentCapabilitySchema, signal }),

    getForBooking: (bookingId: string, signal?: AbortSignal) =>
      client.get(`customer/payments/${encodeURIComponent(bookingId)}`, {
        schema: bookingPaymentSchema,
        signal,
      }),

    /**
     * The amount is taken from the agreed service price, never from here.
     *
     * `CASH` starts a handover that only settles once both parties have
     * confirmed it, so it is a legal choice alongside a gateway payment.
     */
    start: (bookingId: string, method: 'ONLINE' | 'DIRECT' | 'CASH') =>
      client.post(
        `customer/payments/${encodeURIComponent(bookingId)}`,
        startPaymentSchema.parse({ method }),
        { schema: bookingPaymentSchema },
      ),

    getAsProfessional: (bookingId: string, signal?: AbortSignal) =>
      client.get(`professional/payments/${encodeURIComponent(bookingId)}`, {
        schema: professionalPaymentSchema,
        signal,
      }),

    /**
     * The customer's half of a cash handover.
     *
     * Confirming records only that this party agrees the money changed
     * hands. The payment settles once the professional has confirmed it
     * too, so a single confirmation never marks the booking paid.
     */
    confirmCashCustomer: (bookingId: string, note?: string) =>
      client.post(
        `customer/payments/${encodeURIComponent(bookingId)}/cash/confirm`,
        confirmCashPaymentSchema.parse(note === undefined ? {} : { note }),
        { schema: bookingPaymentSchema },
      ),

    /** The professional's half of a cash handover. */
    confirmCashProfessional: (bookingId: string, note?: string) =>
      client.post(
        `professional/payments/${encodeURIComponent(bookingId)}/cash/confirm`,
        confirmCashPaymentSchema.parse(note === undefined ? {} : { note }),
        { schema: bookingPaymentSchema },
      ),

    /** Only the assigned professional can confirm a direct payment receipt. */
    recordDirect: (bookingId: string, note?: string) =>
      client.post(
        `professional/payments/${encodeURIComponent(bookingId)}/direct`,
        recordDirectPaymentSchema.parse({
          received: true,
          ...(note !== undefined ? { note } : {}),
        }),
        { schema: professionalPaymentSchema },
      ),
  };
}

export function createReviewsApi(client: HelpzyApiClient) {
  return {
    listOwn: (signal?: AbortSignal) =>
      client.get('customer/reviews', { schema: reviewsSchema, signal }),

    /** Only allowed once the booking reached a reviewable status. */
    create: (bookingId: string, input: CreateReviewDto) =>
      client.post(`customer/reviews/bookings/${encodeURIComponent(bookingId)}`, input, {
        schema: reviewSchema,
      }),

    /** Published reviews only, which is what the professional's average is built from. */
    listReceived: (signal?: AbortSignal) =>
      client.get('professional/reviews', { schema: professionalReviewsSchema, signal }),

    /** Every moderation status, so an admin can act on pending and rejected rows too. */
    listForModeration: (signal?: AbortSignal) =>
      client.get('admin/reviews', { schema: professionalReviewsSchema, signal }),

    /** `publish` or `reject`, exactly as the admin endpoint defines them. */
    moderate: (reviewId: string, decision: 'publish' | 'reject') =>
      client.post(`admin/reviews/${encodeURIComponent(reviewId)}/${decision}`, undefined, {
        schema: reviewSchema,
      }),
  };
}

/** The chat attached to one booking. There is no cross-booking conversation. */
export function createBookingChatApi(client: HelpzyApiClient) {
  return {
    list: (bookingId: string, signal?: AbortSignal) =>
      client.get(`bookings/${encodeURIComponent(bookingId)}/messages`, {
        schema: bookingMessagesSchema,
        signal,
      }),

    send: (bookingId: string, body: string) =>
      client.post(
        `bookings/${encodeURIComponent(bookingId)}/messages`,
        sendBookingMessageSchema.parse({ body }),
        { schema: bookingMessagesSchema },
      ),
  };
}

export function createLocationApi(client: HelpzyApiClient) {
  return {
    /**
     * The professional's own device position. The API refuses this while
     * sharing is off, so a client can report optimistically and handle the 403.
     */
    report: (latitude: number, longitude: number) =>
      client.post(
        'professional/location',
        { latitude, longitude },
        {
          schema: z.object({ updatedAt: z.string() }),
        },
      ),

    /**
     * A discriminated union: the client can tell "sharing is off" from "the job
     * is not active" from "no fix reported yet" without guessing from nulls.
     */
    forBooking: (bookingId: string, signal?: AbortSignal) =>
      client.get(`customer/bookings/${encodeURIComponent(bookingId)}/location`, {
        schema: assignedProfessionalLocationSchema,
        signal,
      }),
  };
}

export function createProfessionalProfileApi(client: HelpzyApiClient) {
  return {
    getOwn: (signal?: AbortSignal) =>
      client.get('professional/profile', { schema: professionalOwnProfileSchema, signal }),
    updateOwn: (input: UpdateProfessionalProfileDto) =>
      client.patch('professional/profile', updateProfessionalProfileSchema.parse(input), {
        schema: professionalOwnProfileSchema,
      }),
    uploadPhoto: (base64: string, contentType: ProfileImageContentType) =>
      client.post(
        'professional/profile/photo',
        { data: base64, contentType },
        { schema: mediaUploadSchema },
      ),
  };
}

/** The professional's own service list: withdraw to hide, delete to retire. */
export function createProfessionalServicesApi(client: HelpzyApiClient) {
  return {
    list: (signal?: AbortSignal) =>
      client.get('professional/services', { schema: professionalServicesSchema, signal }),

    /** The active categories a service may be filed under. */
    listCategories: (signal?: AbortSignal) =>
      client.get('professional/services/categories', {
        schema: professionalCategoryOptionsSchema,
        signal,
      }),

    create: (input: CreateProfessionalServiceDto) =>
      client.post('professional/services', createProfessionalServiceSchema.parse(input), {
        schema: professionalServiceRecordSchema,
      }),

    update: (serviceId: string, input: UpdateProfessionalServiceDto) =>
      client.patch(
        `professional/services/${encodeURIComponent(serviceId)}`,
        updateProfessionalServiceSchema.parse(input),
        { schema: professionalServiceRecordSchema },
      ),

    /** The API refuses this once the service has booking history. */
    remove: (serviceId: string) =>
      client.delete(`professional/services/${encodeURIComponent(serviceId)}`),
  };
}

export function createAdminApi(client: HelpzyApiClient) {
  return {
    summary: (signal?: AbortSignal) =>
      client.get('admin/summary', { schema: adminDashboardSummarySchema, signal }),

    bookings: (
      filter: { search?: string; status?: string; from?: string; to?: string } = {},
      signal?: AbortSignal,
    ) => client.get('admin/bookings', { schema: adminBookingsSchema, query: filter, signal }),

    listUsers: (
      filter: { role?: string; status?: string; search?: string; categoryId?: string } = {},
      signal?: AbortSignal,
    ) =>
      client.get('admin/users', {
        schema: z.array(adminUserSummarySchema),
        query: filter,
        signal,
      }),

    professionalDetail: (userId: string, signal?: AbortSignal) =>
      client.get(`admin/professionals/${encodeURIComponent(userId)}`, {
        schema: adminProfessionalDetailSchema,
        signal,
      }),

    /** The API refuses a self-change and removing the last active admin. */
    setUserStatus: (userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED') =>
      client.patch(
        `admin/users/${encodeURIComponent(userId)}/status`,
        { status },
        {
          schema: adminUserSummarySchema,
        },
      ),

    verificationRequests: (signal?: AbortSignal) =>
      client.get('admin/verification-requests', {
        schema: z.array(adminVerificationRequestSchema),
        signal,
      }),

    decideVerification: (profileId: string, decision: 'APPROVED' | 'REJECTED', note?: string) =>
      client.post(
        `admin/verification-requests/${encodeURIComponent(profileId)}/decision`,
        adminVerificationDecisionSchema.parse({
          decision,
          ...(note !== undefined ? { note } : {}),
        }),
        { schema: adminVerificationRequestSchema },
      ),

    auditLog: (signal?: AbortSignal) =>
      client.get('admin/audit', { schema: z.array(adminAuditEntrySchema), signal }),

    categories: (filter: { search?: string } = {}, signal?: AbortSignal) =>
      client.get('admin/categories', { schema: adminCategoriesSchema, query: filter, signal }),

    createCategory: (input: CreateCategoryDto) =>
      client.post('admin/categories', createCategorySchema.parse(input), {
        schema: adminCategorySchema,
      }),

    updateCategory: (categoryId: string, input: UpdateCategoryDto) =>
      client.patch(
        `admin/categories/${encodeURIComponent(categoryId)}`,
        updateCategorySchema.parse(input),
        { schema: adminCategorySchema },
      ),

    setCategoryStatus: (categoryId: string, input: SetCategoryStatusDto) =>
      client.patch(
        `admin/categories/${encodeURIComponent(categoryId)}/status`,
        setCategoryStatusSchema.parse(input),
        { schema: adminCategorySchema },
      ),

    /**
     * Every listing the admin can moderate, withdrawn ones included. A reason is
     * required in both directions and is shown to the professional.
     */
    services: (
      filter: { search?: string; categoryId?: string; onlyInactive?: boolean } = {},
      signal?: AbortSignal,
    ) => client.get('admin/services', { schema: adminServicesSchema, query: filter, signal }),

    setServiceStatus: (serviceId: string, input: SetServiceStatusDto) =>
      client.patch(
        `admin/services/${encodeURIComponent(serviceId)}/status`,
        setServiceStatusSchema.parse(input),
        { schema: adminServiceSchema },
      ),

    /* ------------------------------------------------------ reports & disputes */

    reports: (
      filter: { status?: string; reason?: string; search?: string } = {},
      signal?: AbortSignal,
    ) => client.get('admin/reports', { schema: reportsSchema, query: filter, signal }),

    report: (reportId: string, signal?: AbortSignal) =>
      client.get(`admin/reports/${encodeURIComponent(reportId)}`, {
        schema: reportSchema,
        signal,
      }),

    /** Claim a report for triage without deciding it. */
    startReportReview: (reportId: string) =>
      client.patch(
        `admin/reports/${encodeURIComponent(reportId)}/review`,
        // Claiming takes no body. It is parsed through the shared empty schema
        // rather than passed as a bare `{}` so a field added to that schema later
        // cannot be silently dropped on the way out.
        startReportReviewSchema.parse({}),
        {
          schema: reportSchema,
        },
      ),

    resolveReport: (reportId: string, input: ResolveReportDto) =>
      client.patch(
        `admin/reports/${encodeURIComponent(reportId)}/resolve`,
        resolveReportSchema.parse(input),
        { schema: reportSchema },
      ),

    disputes: (filter: { status?: string; search?: string } = {}, signal?: AbortSignal) =>
      client.get('admin/disputes', { schema: disputesSchema, query: filter, signal }),

    dispute: (disputeId: string, signal?: AbortSignal) =>
      client.get(`admin/disputes/${encodeURIComponent(disputeId)}`, {
        schema: disputeDetailSchema,
        signal,
      }),

    startDisputeReview: (disputeId: string) =>
      client.patch(
        `admin/disputes/${encodeURIComponent(disputeId)}/review`,
        {},
        {
          schema: disputeDetailSchema,
        },
      ),

    resolveDispute: (disputeId: string, input: ResolveDisputeDto) =>
      client.patch(
        `admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
        resolveDisputeSchema.parse(input),
        { schema: disputeDetailSchema },
      ),

    /* --------------------------------------------------- booking oversight */

    /** The whole booking in one payload: parties, money, chat and timeline. */
    bookingDetail: (bookingId: string, signal?: AbortSignal) =>
      client.get(`admin/bookings/${encodeURIComponent(bookingId)}`, {
        schema: adminBookingDetailSchema,
        signal,
      }),

    /**
     * Force a booking into a status the normal flow would not reach. The reason
     * is required on both the client and the server: it is what makes an
     * intervention legible afterwards.
     */
    overrideBookingStatus: (bookingId: string, input: OverrideBookingStatusDto) =>
      client.patch(
        `admin/bookings/${encodeURIComponent(bookingId)}/status`,
        overrideBookingStatusSchema.parse(input),
        { schema: adminBookingDetailSchema },
      ),

    refundBooking: (bookingId: string, input: RefundBookingDto) =>
      client.patch(
        `admin/bookings/${encodeURIComponent(bookingId)}/refund`,
        refundBookingSchema.parse(input),
        { schema: adminBookingDetailSchema },
      ),

    /* ------------------------------------------------ platform settings */

    /** The whole settings document, for the admin form. */
    platformSettings: (signal?: AbortSignal) =>
      client.get('admin/settings', { schema: platformSettingsResponseSchema, signal }),

    /**
     * Saves part of the settings document.
     *
     * Parsed client-side with the same schema the server uses, so a contradictory
     * combination is refused before a request is sent rather than after.
     */
    updatePlatformSettings: (input: UpdatePlatformSettings) =>
      client.patch('admin/settings', updatePlatformSettingsSchema.parse(input), {
        schema: platformSettingsResponseSchema,
      }),
  };
}

export type CustomerAccountApi = ReturnType<typeof createCustomerAccountApi>;
export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
export type ProfessionalJobsApi = ReturnType<typeof createProfessionalJobsApi>;
export type PaymentsApi = ReturnType<typeof createPaymentsApi>;
export type ReviewsApi = ReturnType<typeof createReviewsApi>;
export type BookingChatApi = ReturnType<typeof createBookingChatApi>;
export type LocationApi = ReturnType<typeof createLocationApi>;
export type ProfessionalProfileApi = ReturnType<typeof createProfessionalProfileApi>;
export type ProfessionalServicesApi = ReturnType<typeof createProfessionalServicesApi>;
export type AdminApi = ReturnType<typeof createAdminApi>;

export type {
  AdminBookingDetailDto,
  AdminBookingDto,
  AdminCategoryDto,
  AdminProfessionalDetailDto,
  AdminServiceDto,
  AdminUserSummaryDto,
  CreateReportDto,
  DisputeDetailDto,
  DisputeDto,
  OpenDisputeDto,
  OverrideBookingStatusDto,
  RefundBookingDto,
  ReportDto,
  ResolveDisputeDto,
  ResolveReportDto,
  AdminVerificationRequestDto,
  CustomerAddressDto,
  CustomerProfileDto,
  NotificationDto,
  PaymentCapabilityDto,
  ProfessionalCategoryOptionDto,
  ProfessionalOwnProfileDto,
  ProfessionalPaymentDto,
  ProfessionalServiceRecordDto,
  ReviewDto,
  UpsertCustomerAddressDto,
};

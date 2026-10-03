import { createApiClient, HelpzyApiClient } from './client';
import { createAuthApi, type AuthApi } from './endpoints/auth';
import {
  createCustomerDiscoveryApi,
  type CustomerDiscoveryApi,
} from './endpoints/customer-discovery';
import { createCustomerBookingsApi, type CustomerBookingsApi } from './endpoints/customer-bookings';
import {
  createProfessionalBookingsApi,
  type ProfessionalBookingsApi,
} from './endpoints/professional-bookings';
import { createRescheduleApi, type RescheduleApi } from './endpoints/reschedule';
import { createHealthApi, type HealthApi } from './endpoints/health';
import {
  createDisputesApi,
  createReportsApi,
  type DisputesApi,
  type ReportsApi,
} from './endpoints/moderation';
import {
  createAdminApi,
  createBookingChatApi,
  createCustomerAccountApi,
  createLocationApi,
  createNotificationsApi,
  createPaymentsApi,
  createProfessionalJobsApi,
  createProfessionalProfileApi,
  createProfessionalServicesApi,
  createReviewsApi,
  type AdminApi,
  type BookingChatApi,
  type CustomerAccountApi,
  type LocationApi,
  type NotificationsApi,
  type PaymentsApi,
  type ProfessionalJobsApi,
  type ProfessionalProfileApi,
  type ProfessionalServicesApi,
  type ReviewsApi,
} from './endpoints/marketplace';
import {
  createAdminVerificationApi,
  createProfessionalVerificationApi,
  type AdminVerificationApi,
  type ProfessionalVerificationApi,
} from './endpoints/verification-documents';

export * from './client';
export * from './errors';
export * from './endpoints/auth';
export * from './endpoints/customer-discovery';
export * from './endpoints/customer-bookings';
export * from './endpoints/professional-bookings';
export * from './endpoints/reschedule';
export * from './endpoints/health';
export * from './endpoints/marketplace';
export * from './endpoints/moderation';
export * from './endpoints/verification-documents';

export interface HelpzyApi {
  client: HelpzyApiClient;
  auth: AuthApi;
  customerDiscovery: CustomerDiscoveryApi;
  customerBookings: CustomerBookingsApi;
  professionalBookings: ProfessionalBookingsApi;
  /** Rescheduling, for either party to a booking. */
  reschedule: RescheduleApi;
  health: HealthApi;
  customerAccount: CustomerAccountApi;
  notifications: NotificationsApi;
  professionalJobs: ProfessionalJobsApi;
  payments: PaymentsApi;
  reviews: ReviewsApi;
  chat: BookingChatApi;
  location: LocationApi;
  professionalProfile: ProfessionalProfileApi;
  professionalServices: ProfessionalServicesApi;
  reports: ReportsApi;
  disputes: DisputesApi;
  /** A professional's own verification submissions. */
  professionalVerification: ProfessionalVerificationApi;
  /** The admin's verification review queue. */
  adminVerification: AdminVerificationApi;
  admin: AdminApi;
}

/** Single entry point used by the app: `api.health.check()`. */
export function createApi(
  options: ConstructorParameters<typeof HelpzyApiClient>[0] = {},
): HelpzyApi {
  const client = createApiClient(options);
  return {
    client,
    auth: createAuthApi(client),
    customerDiscovery: createCustomerDiscoveryApi(client),
    customerBookings: createCustomerBookingsApi(client),
    professionalBookings: createProfessionalBookingsApi(client),
    reschedule: createRescheduleApi(client),
    health: createHealthApi(client),
    customerAccount: createCustomerAccountApi(client),
    notifications: createNotificationsApi(client),
    professionalJobs: createProfessionalJobsApi(client),
    payments: createPaymentsApi(client),
    reviews: createReviewsApi(client),
    chat: createBookingChatApi(client),
    location: createLocationApi(client),
    professionalProfile: createProfessionalProfileApi(client),
    professionalServices: createProfessionalServicesApi(client),
    reports: createReportsApi(client),
    disputes: createDisputesApi(client),
    professionalVerification: createProfessionalVerificationApi(client),
    adminVerification: createAdminVerificationApi(client),
    admin: createAdminApi(client),
  };
}

/** Shared default instance, configured from the environment. */
export const api: HelpzyApi = createApi();

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
import { createHealthApi, type HealthApi } from './endpoints/health';
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

export * from './client';
export * from './errors';
export * from './endpoints/auth';
export * from './endpoints/customer-discovery';
export * from './endpoints/customer-bookings';
export * from './endpoints/professional-bookings';
export * from './endpoints/health';
export * from './endpoints/marketplace';

export interface HelpzyApi {
  client: HelpzyApiClient;
  auth: AuthApi;
  customerDiscovery: CustomerDiscoveryApi;
  customerBookings: CustomerBookingsApi;
  professionalBookings: ProfessionalBookingsApi;
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
    admin: createAdminApi(client),
  };
}

/** Shared default instance, configured from the environment. */
export const api: HelpzyApi = createApi();

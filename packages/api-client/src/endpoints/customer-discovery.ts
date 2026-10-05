import {
  customerAvailableProfessionalsSchema,
  customerServiceCategoriesSchema,
  customerServiceProfessionalsSchema,
  professionalMarketplaceProfileSchema,
  publicPlatformSettingsSchema,
  type CustomerServiceCategoriesDto,
  type CustomerServiceProfessionalsDto,
} from '@helpzy/validation';
import type { z } from 'zod';

import type { HelpzyApiClient } from '../client';

/**
 * The marketplace location filter.
 *
 * When present, the API returns only professionals and services registered in
 * that place. It is a slug rather than a name so the server can reject an unknown
 * value instead of quietly returning an empty list, and it is passed as a query
 * parameter rather than filtered locally - the client never downloads the whole
 * catalogue and hides most of it.
 */
function locationQuery(location?: string | null): Record<string, string> {
  return location ? { location } : {};
}

export function createCustomerDiscoveryApi(client: HelpzyApiClient) {
  return {
    getCategories: (signal?: AbortSignal, location?: string | null) =>
      client.get('customer/services', {
        schema: customerServiceCategoriesSchema,
        query: locationQuery(location),
        signal,
      }),
    getProfessionalsForService: (
      serviceId: string,
      signal?: AbortSignal,
      location?: string | null,
    ) =>
      client.get(`customer/services/${encodeURIComponent(serviceId)}/professionals`, {
        schema: customerServiceProfessionalsSchema,
        query: locationQuery(location),
        signal,
      }),
    getAvailableProfessionals: (signal?: AbortSignal, location?: string | null) =>
      client.get('customer/professionals', {
        schema: customerAvailableProfessionalsSchema,
        query: locationQuery(location),
        signal,
      }),
    getProfessionalProfile: (professionalId: string, signal?: AbortSignal) =>
      client.get(`customer/professionals/${encodeURIComponent(professionalId)}`, {
        schema: professionalMarketplaceProfileSchema,
        signal,
      }),
    /**
     * Announcements, maintenance state and support contact.
     *
     * Unauthenticated on purpose: someone visiting the marketplace during an
     * outage has not signed in yet, and an empty app with no explanation is the
     * worst possible thing to show them.
     */
    platformSettings: (signal?: AbortSignal) =>
      client.get('platform/settings', {
        schema: publicPlatformSettingsSchema,
        signal,
      }),
  };
}

export type CustomerDiscoveryApi = ReturnType<typeof createCustomerDiscoveryApi>;
export type CustomerServiceCategories = CustomerServiceCategoriesDto;
export type CustomerServiceProfessionals = CustomerServiceProfessionalsDto;
export type PublicPlatformSettings = z.infer<typeof publicPlatformSettingsSchema>['publicView'];

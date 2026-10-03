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

export function createCustomerDiscoveryApi(client: HelpzyApiClient) {
  return {
    getCategories: (signal?: AbortSignal) =>
      client.get('customer/services', {
        schema: customerServiceCategoriesSchema,
        signal,
      }),
    getProfessionalsForService: (serviceId: string, signal?: AbortSignal) =>
      client.get(`customer/services/${encodeURIComponent(serviceId)}/professionals`, {
        schema: customerServiceProfessionalsSchema,
        signal,
      }),
    getAvailableProfessionals: (signal?: AbortSignal) =>
      client.get('customer/professionals', {
        schema: customerAvailableProfessionalsSchema,
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

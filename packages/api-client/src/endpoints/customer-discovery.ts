import {
  customerProfessionalProfileSchema,
  customerAvailableProfessionalsSchema,
  customerServiceCategoriesSchema,
  customerServiceProfessionalsSchema,
  type CustomerServiceCategoriesDto,
  type CustomerServiceProfessionalsDto,
} from '@helpzy/validation';

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
        schema: customerProfessionalProfileSchema,
        signal,
      }),
  };
}

export type CustomerDiscoveryApi = ReturnType<typeof createCustomerDiscoveryApi>;
export type CustomerServiceCategories = CustomerServiceCategoriesDto;
export type CustomerServiceProfessionals = CustomerServiceProfessionalsDto;

import { createApiClient, HelpzyApiClient } from './client';
import { createAuthApi, type AuthApi } from './endpoints/auth';
import {
  createCustomerDiscoveryApi,
  type CustomerDiscoveryApi,
} from './endpoints/customer-discovery';
import { createHealthApi, type HealthApi } from './endpoints/health';

export * from './client';
export * from './errors';
export * from './endpoints/auth';
export * from './endpoints/customer-discovery';
export * from './endpoints/health';

export interface HelpzyApi {
  client: HelpzyApiClient;
  auth: AuthApi;
  customerDiscovery: CustomerDiscoveryApi;
  health: HealthApi;
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
    health: createHealthApi(client),
  };
}

/** Shared default instance, configured from the environment. */
export const api: HelpzyApi = createApi();

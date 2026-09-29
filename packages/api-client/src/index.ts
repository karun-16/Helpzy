import { createApiClient, HelpzyApiClient } from './client';
import { createHealthApi, type HealthApi } from './endpoints/health';

export * from './client';
export * from './errors';
export * from './endpoints/health';

export interface HelpzyApi {
  client: HelpzyApiClient;
  health: HealthApi;
}

/** Single entry point used by the app: `api.health.check()`. */
export function createApi(
  options: ConstructorParameters<typeof HelpzyApiClient>[0] = {},
): HelpzyApi {
  const client = createApiClient(options);
  return {
    client,
    health: createHealthApi(client),
  };
}

/** Shared default instance, configured from the environment. */
export const api: HelpzyApi = createApi();

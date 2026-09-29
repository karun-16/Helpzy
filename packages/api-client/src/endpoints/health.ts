import { API_ROUTES } from '@helpzy/config';
import { healthResponseSchema, type HealthResponseDto } from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

/** Typed endpoints. One method per backend route, no ad-hoc paths in screens. */
export function createHealthApi(client: HelpzyApiClient) {
  return {
    check: (signal?: AbortSignal) =>
      client.get<HealthResponseDto>(API_ROUTES.health, {
        schema: healthResponseSchema,
        signal,
      }),
  };
}

export type HealthApi = ReturnType<typeof createHealthApi>;

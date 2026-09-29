import { z } from 'zod';
import { SERVICE_STATUSES } from '@helpzy/types';

/**
 * Runtime contract for `GET /api/v1/health`.
 *
 * The client parses the response instead of casting it, so a breaking API
 * change surfaces as a typed error rather than as `undefined` deep inside a
 * component.
 */
export const healthCheckResultSchema = z.object({
  name: z.string().min(1),
  status: z.enum(SERVICE_STATUSES),
  latencyMs: z.number().nonnegative(),
  message: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(SERVICE_STATUSES),
  service: z.string().min(1),
  version: z.string().min(1),
  environment: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().min(1),
  checks: z.array(healthCheckResultSchema).default([]),
});

export type HealthResponseDto = z.infer<typeof healthResponseSchema>;

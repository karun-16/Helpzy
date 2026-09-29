/**
 * Health payload returned by `GET /api/v1/health`.
 *
 * The shape is intentionally small and dependency free: the health endpoint
 * must answer even when the database or any downstream service is unavailable.
 * Degraded subsystems are reported through `checks` rather than by failing the
 * request, so a failing database does not look like a failing process.
 */
export const SERVICE_STATUSES = {
  UP: 'UP',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
} as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES];

export interface HealthCheckResult {
  /** Stable dependency identifier, for example `process` or `database`. */
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  message?: string;
}

export interface HealthResponse {
  status: ServiceStatus;
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: HealthCheckResult[];
}

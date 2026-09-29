/**
 * Canonical REST paths for the HELPZY API, split by whether they sit behind the
 * versioned API prefix (`API_GLOBAL_PREFIX`, e.g. `api/v1`).
 *
 * The backend builds its routes from these constants and the api-client calls
 * them, so client and server can never drift apart.
 */

/**
 * Operational endpoints served from the root, outside the versioned prefix.
 * These are used by load balancers, uptime probes and the status screen, and
 * their path must stay stable across API versions.
 */
export const OPERATIONAL_ROUTES = {
  health: '/health',
} as const;

/** Product endpoints served under the versioned prefix. Populated per phase. */
export const API_ROUTES = {} as const;

export type OperationalRoute = (typeof OPERATIONAL_ROUTES)[keyof typeof OPERATIONAL_ROUTES];

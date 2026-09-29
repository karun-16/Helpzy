/**
 * Environment resolution for the shared packages.
 *
 * The API runs in Node and reads `process.env`. The Expo bundle has no
 * `process.env` for server-side secrets, so the frontend receives its
 * configuration through `EXPO_PUBLIC_*` variables injected by `app.config.ts`.
 * Both sides funnel through the same helpers so the precedence rules are
 * identical and documented in exactly one place.
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export const DEFAULT_API_TIMEOUT_MS = 15_000;

export const DEFAULT_API_GLOBAL_PREFIX = 'api/v1';

export type PublicEnv = Record<string, string | undefined>;

function readString(env: PublicEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInt(env: PublicEnv, key: string): number | undefined {
  const raw = readString(env, key);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Base URL of the HELPZY API, without a trailing slash. */
export function resolveApiBaseUrl(env: PublicEnv): string {
  const baseUrl = readString(env, 'EXPO_PUBLIC_API_BASE_URL') ?? DEFAULT_API_BASE_URL;
  return baseUrl.replace(/\/+$/, '');
}

/** Timeout applied to outgoing API requests, in milliseconds. */
export function resolveApiTimeoutMs(env: PublicEnv): number {
  const timeoutMs = readInt(env, 'EXPO_PUBLIC_API_TIMEOUT_MS');
  if (timeoutMs === undefined || timeoutMs <= 0) return DEFAULT_API_TIMEOUT_MS;
  return timeoutMs;
}

/** Route prefix applied to every REST endpoint, e.g. `api/v1`. */
export function resolveApiGlobalPrefix(env: PublicEnv): string {
  const prefix = readString(env, 'API_GLOBAL_PREFIX') ?? DEFAULT_API_GLOBAL_PREFIX;
  return prefix.replace(/^\/+|\/+$/g, '');
}

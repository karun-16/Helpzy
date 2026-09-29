/**
 * PHASE 1 smoke test: the contract between the shared client and a running
 * NestJS API, exercised with the exact code the frontend uses at runtime.
 *
 *   pnpm dev:api           # terminal 1
 *   pnpm smoke             # terminal 2
 *
 * Override the target with API_BASE_URL / API_GLOBAL_PREFIX.
 */
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { createApi, HelpzyApiClient, ApiError } = require('@helpzy/api-client');
const { healthResponseSchema } = require('@helpzy/validation');

const env = {
  EXPO_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
  EXPO_PUBLIC_API_GLOBAL_PREFIX: process.env.API_GLOBAL_PREFIX ?? 'api/v1',
  EXPO_PUBLIC_API_TIMEOUT_MS: process.env.API_TIMEOUT_MS ?? '15000',
};

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

const { client, health } = createApi({ env });

// 1. The unversioned health route returns a payload the shared schema accepts.
try {
  const raw = await health.check();
  const parsed = healthResponseSchema.safeParse(raw);
  record(
    'GET /health responds',
    true,
    `${raw.service} ${raw.status} in ${raw.checks[0]?.latencyMs ?? '?'} ms`,
  );
  record(
    'GET /health matches the shared schema',
    parsed.success,
    parsed.success ? `environment ${raw.environment}` : parsed.error.message,
  );
} catch (error) {
  record('GET /health responds', false, error instanceof ApiError ? error.message : String(error));
}

// 2. Unversioned requests do not pick up the api/v1 prefix.
try {
  await client.requestUnversioned('/definitely-not-a-route');
  record('unversioned request skips the api/v1 prefix', false, 'request unexpectedly succeeded');
} catch (error) {
  const ok = error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND';
  record(
    'unversioned request skips the api/v1 prefix',
    ok,
    ok ? `requestId ${error.requestId ?? 'n/a'}` : String(error),
  );
}

// 3. Unknown versioned routes still produce the typed error envelope.
try {
  await client.request('/definitely-not-a-route');
  record(
    'versioned request returns the typed error envelope',
    false,
    'request unexpectedly succeeded',
  );
} catch (error) {
  const ok = error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND';
  record(
    'versioned request returns the typed error envelope',
    ok,
    ok ? 'api/v1/... reached the router' : String(error),
  );
}

// 4. A client pointed at a dead port fails fast with a network ApiError rather
//    than hanging, which is what the UI renders as "Unreachable".
try {
  await new HelpzyApiClient({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 }).requestUnversioned(
    '/health',
  );
  record('unreachable API surfaces ApiError', false, 'request unexpectedly succeeded');
} catch (error) {
  const ok = error instanceof ApiError && error.code === 'NETWORK_ERROR';
  record('unreachable API surfaces ApiError', ok, ok ? error.message : String(error));
}

const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} smoke checks passed`);
// `process.exitCode` instead of `process.exit()`: forcing the exit while the
// undici connection pool still holds sockets trips a libuv assertion on Node 24.
process.exitCode = failed.length === 0 ? 0 : 1;

import { resolve } from 'node:path';
import { z } from 'zod';

const DEVELOPMENT_AUTH_JWT_SECRET = 'helpzy-local-development-jwt-secret-only';

/**
 * Typed, validated runtime configuration.
 *
 * The process refuses to boot on invalid configuration: a misconfigured
 * deployment must fail fast and loudly at start-up rather than at the first
 * request that happens to need the missing value.
 */

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development')
      .describe('Runtime environment.'),

    LOG_LEVEL: z
      .enum(['error', 'warn', 'log', 'debug', 'verbose'])
      .default('log')
      .describe('Minimum NestJS logger level.'),

    /**
     * Port the HTTP server binds to.
     *
     * Render (and most PaaS providers) inject `PORT` at runtime and route
     * incoming traffic to exactly that port, so it has to win when it is
     * present. `API_PORT` stays the fallback, which is what every local
     * development machine uses - nothing there sets `PORT`.
     */
    PORT: z.coerce.number().int().min(1).max(65_535).optional(),

    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

    API_HOST: z.string().min(1).default('0.0.0.0'),

    API_GLOBAL_PREFIX: z
      .string()
      .default('api/v1')
      .describe('Prefix applied to all API routes, e.g. api/v1.'),

    API_CORS_ORIGINS: z
      .string()
      .default(
        'http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006,http://127.0.0.1:19006',
      )
      .describe(
        'Comma separated list of allowed browser origins. Wildcards are rejected: this API sends credentials.',
      ),

    DATABASE_URL: z
      .string()
      .optional()
      .describe('PostgreSQL connection string. Required from PHASE 2 (Prisma) onwards.'),

    AUTH_JWT_SECRET: z.string().min(1).default(DEVELOPMENT_AUTH_JWT_SECRET),
    AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
    OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
    MFA_TTL_SECONDS: z.coerce.number().int().min(30).default(300),

    MEDIA_UPLOAD_DIR: z
      .string()
      .default('uploads')
      .describe('Directory used by the local media storage provider.'),
    MEDIA_PUBLIC_BASE_URL: z
      .string()
      .default('/media')
      .describe('Public path the API serves locally stored uploads from.'),
    MEDIA_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(5 * 1024 * 1024)
      .describe('Maximum accepted upload size in bytes.'),

    PAYMENT_ONLINE_PROVIDER: z
      .string()
      .optional()
      .describe(
        'Name of the configured online payment gateway. When absent, no online path is offered at all.',
      ),
    /**
     * Root for files that must never be served publicly.
     *
     * Verification documents are identity documents, so they are kept outside
     * `MEDIA_UPLOAD_DIR` and deliberately *not* mounted by `serveLocalMedia`.
     * Relative paths resolve beside the public root rather than inside it, which
     * is what makes the public static mount unable to reach them.
     */
    PRIVATE_MEDIA_UPLOAD_DIR: z
      .string()
      .default('private-uploads')
      .describe('Directory for private uploads such as verification documents.'),

    /**
     * Built Expo web export served by this process.
     *
     * Relative paths resolve against the repository root, which is where
     * `expo export --output-dir dist` puts it. The mount is skipped entirely
     * when the directory is absent, so a development checkout that has never run
     * the web build simply has no static handler.
     */
    WEB_CLIENT_DIR: z
      .string()
      .default('apps/frontend/dist')
      .describe('Built Expo web export served as static files with SPA history fallback.'),

    PAYMENT_ONLINE_API_KEY: z.string().optional(),

    /**
     * Secret used to sign and verify gateway callbacks.
     *
     * Required for any online path: with no secret there is no way to tell a
     * genuine callback from a forged one, so the API refuses to start a
     * checkout rather than trusting an unverifiable callback.
     */
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),

    /** Where the sandbox gateway sends the customer to "pay". Never live. */
    PAYMENT_SANDBOX_CHECKOUT_BASE_URL: z
      .string()
      .default('http://localhost:4000/api/v1/payments/sandbox/checkout'),

    LOCATION_STALE_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(15)
      .describe('Age after which a shared professional location is shown as stale.'),

    TZ: z.string().default('Asia/Kolkata'),
  })
  .superRefine((env, context) => {
    if (
      env.NODE_ENV === 'production' &&
      (env.AUTH_JWT_SECRET === DEVELOPMENT_AUTH_JWT_SECRET || env.AUTH_JWT_SECRET.length < 32)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_JWT_SECRET'],
        message: 'must be set to a unique random value of at least 32 characters in production.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  logLevel: Env['LOG_LEVEL'];
  port: number;
  host: string;
  globalPrefix: string;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  authJwtSecret: string;
  authTokenTtlSeconds: number;
  otpTtlSeconds: number;
  mfaTtlSeconds: number;
  mediaUploadDir: string;
  mediaPublicBaseUrl: string;
  mediaMaxBytes: number;
  privateMediaUploadDir: string;
  /** Built Expo web export. Absent in a checkout that has not built the app. */
  webClientDir: string;
  /** Present only when a real online gateway is configured. */
  paymentOnlineProvider: string | undefined;
  paymentOnlineApiKey: string | undefined;
  paymentWebhookSecret: string;
  paymentSandboxCheckoutBaseUrl: string;
  locationStaleMinutes: number;
  timezone: string;
}

export function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    port: env.PORT ?? env.API_PORT,
    /*
     * A container is only reachable through every one of its interfaces, so
     * production binds to `0.0.0.0` whatever `API_HOST` says. Left to the
     * default it would also be correct locally, but honouring an explicit
     * `API_HOST` in development is worth keeping.
     */
    host: env.NODE_ENV === 'production' ? '0.0.0.0' : env.API_HOST,
    globalPrefix: env.API_GLOBAL_PREFIX,
    corsOrigins: parseCsv(env.API_CORS_ORIGINS),
    databaseUrl: env.DATABASE_URL,
    authJwtSecret: env.AUTH_JWT_SECRET,
    authTokenTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS,
    otpTtlSeconds: env.OTP_TTL_SECONDS,
    mfaTtlSeconds: env.MFA_TTL_SECONDS,
    mediaUploadDir: resolve(resolve(__dirname, '../..'), env.MEDIA_UPLOAD_DIR),
    mediaPublicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
    mediaMaxBytes: env.MEDIA_MAX_BYTES,
    // Resolved beside the public root rather than inside it, so the public
    // static mount can never serve these bytes.
    privateMediaUploadDir: resolve(
      resolve(resolve(__dirname, '../..'), env.MEDIA_UPLOAD_DIR),
      '..',
      env.PRIVATE_MEDIA_UPLOAD_DIR,
    ),
    // Repository root, four levels up from `dist/config` or `src/config`.
    webClientDir: resolve(resolve(__dirname, '../../../..'), env.WEB_CLIENT_DIR),
    paymentOnlineProvider: env.PAYMENT_ONLINE_PROVIDER,
    paymentOnlineApiKey: env.PAYMENT_ONLINE_API_KEY,
    // A development-only default so the sandbox gateway is usable out of the box.
    // In production a real secret must be supplied, because a known default
    // would let anybody forge a payment callback.
    paymentWebhookSecret:
      env.PAYMENT_WEBHOOK_SECRET ??
      (env.NODE_ENV === 'production' ? '' : 'helpzy-development-webhook-secret'),
    paymentSandboxCheckoutBaseUrl: env.PAYMENT_SANDBOX_CHECKOUT_BASE_URL,
    locationStaleMinutes: env.LOCATION_STALE_MINUTES,
    timezone: env.TZ,
  };
}

function parseCsv(value: string): string[] {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  // The API is configured with `credentials: true`, so a wildcard would make the
  // server echo back whatever `Origin` it was sent. That hands any website on
  // the internet a credentialed channel to this API, so it is refused at
  // start-up rather than silently accepted.
  const wildcard = entries.find((entry) => entry === '*' || entry.toLowerCase() === 'null');
  if (wildcard !== undefined) {
    throw new Error(
      `API_CORS_ORIGINS contains the wildcard "${wildcard}". This API sends credentials, ` +
        'so every allowed origin must be listed explicitly, ' +
        'e.g. API_CORS_ORIGINS=http://localhost:8081.',
    );
  }

  return entries;
}

/**
 * Candidate locations of the single root `.env` file.
 *
 * `pnpm --filter @helpzy/api dev` runs with `backend/api` as the working
 * directory, while `node backend/api/dist/main.js` runs from the repository
 * root; both must find the same file.
 */
export const envFileCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../../../.env'),
];

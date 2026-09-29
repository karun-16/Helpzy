import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Typed, validated runtime configuration.
 *
 * The process refuses to boot on invalid configuration: a misconfigured
 * deployment must fail fast and loudly at start-up rather than at the first
 * request that happens to need the missing value.
 */

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development')
    .describe('Runtime environment.'),

  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'])
    .default('log')
    .describe('Minimum NestJS logger level.'),

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

  AUTH_JWT_SECRET: z.string().default('helpzy-dev-secret-change-me'),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
  OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  MFA_TTL_SECONDS: z.coerce.number().int().min(30).default(300),

  TZ: z.string().default('Asia/Kolkata'),
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
  timezone: string;
}

export function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    port: env.API_PORT,
    host: env.API_HOST,
    globalPrefix: env.API_GLOBAL_PREFIX,
    corsOrigins: parseCsv(env.API_CORS_ORIGINS),
    databaseUrl: env.DATABASE_URL,
    authJwtSecret: env.AUTH_JWT_SECRET,
    authTokenTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS,
    otpTtlSeconds: env.OTP_TTL_SECONDS,
    mfaTtlSeconds: env.MFA_TTL_SECONDS,
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

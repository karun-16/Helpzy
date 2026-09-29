import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (replaces the deprecated `package.json#prisma`
 * block and is the format Prisma 7 requires).
 *
 * Paths are relative to this file's directory, which is the backend workspace
 * root. The datasource URL comes from `DATABASE_URL`, loaded from the
 * repository-root `.env` by `scripts/prisma.mjs` before the CLI is started.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  // No telemetry prompt: this repository is developed in non-interactive shells
  // and a first-run question on stdin would hang the CLI.
  telemetry: { enabled: false },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
});

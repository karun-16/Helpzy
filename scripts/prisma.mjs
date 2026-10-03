/**
 * Prisma CLI entry point that keeps the root `.env` as the single source of
 * truth.
 *
 * Prisma looks for `DATABASE_URL` in the schema folder or the current working
 * directory, but HELPZY's environment file lives at the repository root. This
 * wrapper loads it and then hands over to the real CLI, so `pnpm db:migrate`
 * works from anywhere in the workspace and the connection string is never
 * duplicated.
 *
 * The CLI is started through `process.execPath` rather than the `.bin` shim so
 * no shell is involved (Windows shims are `.cmd`, which would require
 * `shell: true` and an unescaped command line).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(repoRoot, 'backend', 'api');
const envFile = join(repoRoot, '.env');

if (existsSync(envFile)) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: envFile, quiet: true });
}

const require = createRequire(join(apiRoot, 'package.json'));
const prismaPackagePath = require.resolve('prisma/package.json');
const prismaEntry = join(dirname(prismaPackagePath), require(prismaPackagePath).bin.prisma);

/**
 * `prisma db seed` runs the seed command through a shell, so the CLI binaries the
 * command names (`ts-node`) are resolved by name rather than by pnpm's own
 * `exec`. Prepending the workspace bin directories makes the seed work from a
 * bare `pnpm db:seed` on every platform instead of only when a package manager
 * happened to put them on PATH.
 */
const binDirs = [
  join(repoRoot, 'node_modules', '.bin'),
  join(apiRoot, 'node_modules', '.bin'),
].filter((dir) => existsSync(dir));

const child = spawn(process.execPath, [prismaEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: apiRoot,
  env: {
    ...process.env,
    PATH: [...binDirs, process.env.PATH].filter(Boolean).join(delimiter),
  },
});

child.on('error', (error) => {
  console.error(`Failed to start the Prisma CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

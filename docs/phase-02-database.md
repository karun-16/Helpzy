# PHASE 2 - Database - status report

Delivered on 2026-09-28. Final hardening pass on 2026-09-29. Phase 1 report:
[`phase-01-foundation.md`](phase-01-foundation.md).

## Status

| Area                        | Status  | Evidence                                                        |
| --------------------------- | ------- | --------------------------------------------------------------- |
| PostgreSQL 18 instance      | PASS    | `18.6`, service `postgresql-x64-18` running, `helpzy` role + db |
| `DATABASE_URL` in config    | PASS    | `AppConfig.databaseUrl` validated from the environment          |
| Prisma schema               | PASS    | `pnpm --filter @helpzy/api run db:validate`                     |
| Prisma client generation    | PASS    | `db:generate` - v6.19.3                                         |
| `PrismaService`             | PASS    | `Database connection established` in the API log                |
| `prisma migrate dev`        | PASS    | `prisma/migrations/20260928085028_init` applied                 |
| `prisma migrate reset`      | PASS    | `Database reset successful`, then re-seeded                     |
| Migration state             | PASS    | `migrate status` - `Database schema is up to date!`             |
| Idempotent seed             | PASS    | Three consecutive runs, identical counts every time             |
| Database health check       | PASS    | `GET /api/v1/health` reports `process: UP`, `database: UP`      |
| CORS allow-list             | PASS    | Explicit list, no wildcard, no origin reflection                |
| Security headers            | PASS    | Helmet 8.3.0 headers observed on real HTTP responses            |
| 404 + request id            | PASS    | 5 unknown paths, 12/12 HTTP checks, ids echoed into the log     |
| Format / lint / typecheck   | PASS    | `pnpm verify` exit 0                                            |
| Unit + e2e tests            | PASS    | 8 unit, 10 e2e                                                  |
| Live contract               | PASS    | 5/5 smoke, 40/40 Phase 1 matrix, 12/12 Phase 2 matrix           |
| Web / Android / iOS exports | PARTIAL | Exports succeed; no device or simulator run                     |

## What was built

- `backend/api/prisma/schema.prisma` - 8 models (`User`, `ProfessionalProfile`,
  `ServiceCategory`, `Service`, `Address`, `Booking`, `Payment`, `Review`) and
  the 9 enums the domain needs. Enum values are the same constants the shared
  `@helpzy/types` package exposes, so the contract cannot drift silently.
- `backend/api/prisma/seed.ts` - idempotent development fixtures: 4 users, 2
  professional profiles, 6 categories, 3 services, 1 booking, 1 payment. Every
  write is an `upsert` keyed on a natural key, so re-running changes nothing.
- `backend/api/src/database/prisma.service.ts` - the connection lifecycle.
- `backend/api/src/health/health.service.ts` - a `SELECT 1` probe timed and
  reported as its own named check.
- `scripts/prisma.mjs` - loads the root `.env` and runs the Prisma CLI without a
  shell, so `prisma` behaves the same from the repo root and from a workspace.

## PostgreSQL setup

Verified against PostgreSQL 18.6 on Windows. The role and database are created
once, by a human, because it needs the `postgres` superuser:

```powershell
psql -U postgres -c "CREATE ROLE helpzy LOGIN PASSWORD 'helpzy_dev_password' CREATEDB;" \
                 -c "CREATE DATABASE helpzy OWNER helpzy;"
```

Then apply the schema and fixtures:

```bash
pnpm --filter @helpzy/api run db:migrate   # apply migrations
pnpm --filter @helpzy/api run db:seed      # development fixtures, safe to re-run
pnpm --filter @helpzy/api run db:reset     # drop, re-apply, re-seed
```

A winget silent install does not record the superuser password anywhere
recoverable, so it has to be typed at least once in a terminal. `CREATEDB` is
required on the role: `prisma migrate dev` builds a shadow database from the
same credentials.

## Prisma setup

- Prisma `6.19.3`, not 7. Prisma 7 is ESM-only and would have forced a
  toolchain migration in the same commit as the data layer. 6.19.3 is the newest
  release that works with the CommonJS NestJS build and the current Jest setup.
- `prisma.config.ts` with `telemetry: { enabled: false }`. The CLI's first-run
  telemetry question blocks on stdin, which hangs every non-interactive shell.
- The CLI is always invoked through `scripts/prisma.mjs`, which loads the root
  `.env` first. With a config file present Prisma no longer reads `.env` itself,
  so the wrapper is what keeps `db:*` scripts working from any directory.
- `migrate dev` asks for a migration name on stdin. In a non-interactive shell
  pass one: `node scripts/prisma.mjs migrate dev --name <label>`.

## Database schema

8 models, 9 enums, all relations and the constraints the domain needs:

| Model                 | Purpose                                     | Notable constraints                                             |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `User`                | One identity for every role                 | `email` unique; `role` and `status` enums                       |
| `ProfessionalProfile` | Public provider record linked 1:1 to `User` | `userId` unique                                                 |
| `ServiceCategory`     | Catalogue grouping                          | `slug` unique                                                   |
| `Service`             | A bookable offering owned by a provider     | `professionalId`, `categoryId` indexed                          |
| `Address`             | Service location                            | One default address per user enforced by a partial unique index |
| `Booking`             | A scheduled job                             | `@@unique([professionalId, scheduledStart])`, `status` enum     |
| `Payment`             | Money movement for a booking                | `status`, `method`, provider-reference fields                   |
| `Review`              | Customer rating with moderation state       | `bookingId` unique, `status` enum, nullable `moderatedBy`       |

## Migration

One migration, `20260928085028_init`, created by `prisma migrate dev` and
committed under `backend/api/prisma/migrations/`. `migrate status` reports
`Database schema is up to date!` against the local database.

## Seed and idempotency

The seed uses `upsert` on natural keys only - never `create` for a record that
must already exist, never a hard-coded primary key. Final record counts, after
three consecutive runs:

| Table                   | Count |
| ----------------------- | ----- |
| `users`                 | 4     |
| `professional_profiles` | 2     |
| `service_categories`    | 6     |
| `services`              | 3     |
| `addresses`             | 1     |
| `bookings`              | 1     |
| `payments`              | 1     |

Seed accounts, all with the password `Helpzy@123`:

| Role         | Email                  |
| ------------ | ---------------------- |
| CUSTOMER     | `customer@helpzy.test` |
| PROFESSIONAL | `pro@helpzy.test`      |
| PROFESSIONAL | `pro2@helpzy.test`     |
| ADMIN        | `admin@helpzy.test`    |

The seed hashes with SHA-256 **because there is no password handling yet**.
Phase 3 replaces this with argon2id; the placeholder is deliberately visible in
the code so it cannot be mistaken for finished auth work.

## Database health check

`GET /api/v1/health` probes the database with `SELECT 1` and reports it as a named
check, so a probe failure says which dependency is down:

```json
{
  "success": true,
  "data": {
    "status": "UP",
    "checks": [
      { "name": "process", "status": "UP", "latencyMs": 0.02 },
      { "name": "database", "status": "UP", "latencyMs": 4.14 }
    ]
  }
}
```

The probe never throws. An unavailable database is a `200` with `status: DOWN`,
because a health endpoint that dies with its dependency cannot report it. The
health `message` is written for operators reading the API logs and can contain
infrastructure detail, so the app renders the check name, status and latency
only.

Startup policy: `PrismaService` opens one connection on module init. In
production a failure rethrows, so a process that cannot reach its database never
accepts traffic. In development and test the process starts anyway and logs the
error - availability of the health endpoint is worth more locally than failing
fast.

## CORS configuration

Environment driven, allow-list only, no wildcard.

- Variable: `API_CORS_ORIGINS`, a comma separated list, validated at start-up.
- Canonical development origin: **`http://localhost:8081`** - the Expo web dev
  server (`pnpm dev:web`). `http://127.0.0.1:8081` is listed as well, because
  those are different origins to a browser.
- `19006` covers Expo Go and the dev client, for a device on the same network.
- `3000` covers a static web export preview, because a static server picks its
  own port and the origin must match exactly.
- A wildcard is **rejected at start-up**, not merely ignored. The API is
  configured with `credentials: true`, so reflecting any `Origin` would hand
  every website on the internet a credentialed channel to this API. The literal
  string `null` is rejected for the same reason.

No other origins are exposed. To preview on a different port, add that port to
`API_CORS_ORIGINS`.

## Security headers

[Helmet](https://helmetjs.github.io/) 8.3.0 is applied in `configureApp`, so dev
server, tests and production all get identical headers. It runs after the
request-id middleware (so nothing is logged untraced) and before CORS (so CORS
headers are added last and are never stripped by a header policy).

Headers observed on a live `GET /api/v1/health`:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
X-XSS-Protection: 0
```

`contentSecurityPolicy` is the only default that is disabled: this API serves
JSON over `fetch` and never an HTML document, so a CSP would protect nothing
while confusing anyone who saw the header. Everything else is Helmet's default
and nothing extra was added - no CSRF protection, no rate limiting, no cookie
session middleware. Those arrive with the phase that needs them.

## Request id and 404 behaviour

Both were delivered in Phase 1 and re-verified here after the security changes.

- The id is assigned by plain Express middleware, so a request that matches no
  route is still traced.
- An inbound `x-request-id` is reused; otherwise a UUID is generated.
- The id is returned in the `x-request-id` header, in `meta.requestId` on
  success, in `error.requestId` on failure, and in the server log line.
- Unknown routes return the one existing envelope,
  `{ "error": { code, message, requestId, timestamp } }`, with
  `code: NOT_FOUND` and the message `The requested resource was not found.`.
  The router's own `Cannot GET /x` is replaced, so no routing or framework
  detail reaches the client, and no stack is ever included.

Verified on a running server against `/api/v1/does-not-exist`,
`/does-not-exist`, `/api/v1/%E0%A4%A`, a deeply nested unknown path, and a path
with a `..` segment. All 404, all valid JSON, all carrying the id that was sent.

## What failed along the way

- The `postgres` superuser password is not recoverable from a winget silent
  install, so the `helpzy` role and database had to be created from a terminal
  that knows the password.
- `prisma migrate dev` waits for a migration name on stdin, which hangs
  automation.
- `seed.ts` imported `Prisma` as a type but used it as a value
  (`Prisma.Decimal`). `tsc` is not run by `ts-node` in the seed path, so this
  only surfaced when the seed actually executed.
- `db:generate` fails with `EPERM ... rename query_engine-windows.dll.node` while
  the API is running, because Windows locks a loaded DLL. Stop the API first.
- The CORS wildcard branch reflected any `Origin` on a credentialed API. Removed
  in this pass; the wildcard is now a start-up error.

## Known deferred items

1. **No device or simulator run.** Web, Android and iOS exports succeed, but the
   app has only been seen in a headless browser.
2. **No frontend test runner.** `jest-expo` is still deferred; the app's logic is
   thin enough that live checks are the current verification.
3. **Seed passwords are SHA-256.** Replaced by argon2id in Phase 3. No password
   verification exists yet, so nothing depends on the hash today.
4. **No authentication, guards or RBAC.** Phase 3.
5. **Booking slot uniqueness is per provider and start time, not per service.**
   Two services starting at the same instant for one provider are blocked by
   `@@unique([professionalId, scheduledStart])`. That is the intended behaviour
   today, but it assumes a fixed slot length. If services gain different
   durations, the constraint has to become a range check - an overlap test, not
   an equality. This is a Phase 5 booking-engine concern and is deliberately not
   redesigned now.
6. **No `Role` table.** Roles are an enum on `User`. Fine until permissions need
   to be edited at runtime.
7. **`POST /health` returns 404, not 405.** Cosmetic, inherited from Nest's
   router; the envelope and request id are correct.

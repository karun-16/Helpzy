# PHASE 1 - Foundation status

All commands below were run on Windows 11, Node 24.15.0, pnpm 11.19.0.

```
HELPZY PHASE 1 STATUS

Frontend (Web):        PASS
Frontend (Android):    PARTIAL - bundle builds, not run on a device
Frontend (iOS):        PARTIAL - bundle builds, not run in a simulator
Backend (NestJS health): PASS
Database:              NOT DONE - deferred to PHASE 2 by design
                      (delivered in PHASE 2, see phase-02-database.md)
Shared packages:       PASS
Lint:                  PASS
Typecheck:             PASS
Tests:                 PASS
Environment issues:    RESOLVED (4 found, 4 fixed)
```

## Frontend (Web)

One Expo Router application in `apps/frontend`, built with Expo SDK 57, React
19.2, React Native 0.86 and React Native Web 0.21, styled with NativeWind 4 +
Tailwind 3.4.

- Production export: `apps/frontend/dist` - 909 modules, 1.7 MB JS, 9.6 KB CSS,
  `index.html` + `metadata.json`.
- Rendered and exercised in a real browser engine (headless Edge). The DOM shows
  the styled foundation screen (Tailwind classes resolved by the generated CSS)
  and, after the API call, the live status card reading
  `UP - helpzy-api - development - 1 check - Responded in 0.1 ms`.
- The same bundle returns a graceful `Unreachable` card when the API is down,
  with the error surfaced through `ApiError`.
- Screenshots: `docs/screenshots/phase-1-web-desktop.png`,
  `docs/screenshots/phase-1-web-mobile.png`.
- `expo-doctor`: 21/21 checks pass.

## Frontend (Android)

- `expo export --platform android` produces Hermes bytecode
  (`_expo/static/js/android/entry-*.hbc`, 4.4 MB) plus 18 assets and metadata.
- Bundle identifier `com.helpzy.app`, portrait + tablet support configured.
- **Not verified**: no Android device or emulator was available in this
  environment, so `pnpm dev:android` and the on-device experience are untested.
  The developer's first action in PHASE 2 should be opening it on a device.

## Frontend (iOS)

- `expo export --platform ios` produces Hermes bytecode
  (`_expo/static/js/ios/entry-*.hbc`, 4.1 MB) plus assets and metadata.
- Bundle identifier `com.helpzy.app`, `supportsTablet: true`.
- **Not verified**: running a simulator or device needs macOS with Xcode; this
  machine is Windows, so `pnpm dev:ios` was never executed.

## Backend (NestJS health)

`backend/api`, NestJS 11 on Node, CommonJS.

- `GET /health` returns 200 with the shared success envelope:
  `{ success, data: { status, service, version, environment, uptimeSeconds, timestamp, checks }, meta: { requestId, timestamp } }`.
- Health is served unversioned at the root and excluded from `API_GLOBAL_PREFIX`
  (`api/v1`), so uptime probes keep working across API versions.
- Cross-cutting HTTP contract, applied in one function (`configureApp`) shared by
  the dev server and the tests: CORS, request ids, success envelope, global
  exception filter.
- Verified against a running process: 40/40 live checks covering
  `/api/v1/health`, `/api/v1/does-not-exist`, `/does-not-exist`, malformed
  paths, wrong methods, malformed JSON bodies, request-id echo and generation,
  CORS preflight, unknown origins, and log correlation.

## Database

Nothing was built, deliberately: the schema, migrations and seed data are
PHASE 2 scope. This section is kept as the PHASE 1 record of what was true at
that time.

- PostgreSQL 14 and 18 were installed on this machine but the services were
  stopped; no HELPZY database existed and no connection had been verified.
- Prisma was not installed. `.env.example` already carried the `DATABASE_URL`
  contract and the frontend/backend config paths were in place.
- This was the one item in the PHASE 1 brief that was not delivered. The brief
  listed "PostgreSQL Prisma" under PHASE 1 and "Prisma schema and migrations"
  under PHASE 2; only the second was treated as PHASE 1 work.
- **Superseded:** PHASE 2 delivered the schema, migration, seed and the database
  health check. See [`phase-02-database.md`](phase-02-database.md).

## Shared packages

| Package              | Purpose                                           | Built | Consumed by             |
| -------------------- | ------------------------------------------------- | ----- | ----------------------- |
| `@helpzy/types`      | Domain + transport types, error codes, envelopes  | yes   | API, app, client        |
| `@helpzy/validation` | Zod schemas, `*Dto` types                         | yes   | API, client             |
| `@helpzy/api-client` | Typed fetch client, `ApiError`, health endpoint   | yes   | app                     |
| `@helpzy/config`     | Brand strings, env resolution, shared route paths | yes   | app config, API, client |

- `pnpm install` builds them through the root `postinstall`.
- Each publishes `dist/` (CJS + types) plus a `react-native` export condition
  that points Metro at the TypeScript source.
- The API and the app both import the same schema, so a contract change breaks
  one side at compile time.

## Lint

- ESLint 9 flat config at the repository root (`eslint.config.mjs`), found from
  every workspace, so the six workspaces share one rule set and one Prettier run.
- Rules: `js.recommended`, `typescript-eslint` recommended, Prettier as an error,
  `react-hooks` recommended for the frontend, plus `eqeqeq`/`prefer-const`.
- `pnpm lint` -> exit 0 across all 6 workspaces.
- One documented exception: `react-hooks/set-state-in-effect` is disabled at the
  single initial-fetch call site in `src/app/index.tsx`, because the state update
  happens in a promise callback, not synchronously in the effect body.

## Typecheck

- `tsc --noEmit` in all 6 workspaces, `strict` on, `noUncheckedIndexedAccess`
  on: `pnpm typecheck` -> exit 0.
- One fix was needed: `test/config.spec.ts` imported `@jest/globals`, which was
  not a declared dependency, so the test file did not typecheck.

## Tests

| Suite            | Command                               | Result                            |
| ---------------- | ------------------------------------- | --------------------------------- |
| Unit             | `pnpm test:api`                       | 4/4 passed                        |
| E2E              | `pnpm test:api:e2e`                   | 7/7 passed                        |
| Live contract    | `pnpm smoke`                          | 5/5 passed (needs `pnpm dev:api`) |
| Live HTTP matrix | manual harness                        | 40/40 passed                      |
| Project health   | `expo-doctor`                         | 21/21 passed                      |
| Platform bundles | `build`, `build:android`, `build:ios` | all exit 0                        |
| Gate             | `pnpm verify`                         | exit 0                            |

Frontend unit tests do not exist yet: no test runner is configured for the Expo
app. `jest-expo` arrives with the first phase that ships testable UI logic. The
frontend is instead verified by typecheck, lint, the three platform exports,
`expo-doctor` and a real browser render.

## Environment issues

Four problems were hit and all four are fixed:

1. **Metro could not resolve `react-native-css-interop/jsx-runtime`** and then
   `@expo/metro-runtime` and `expo-modules-core`. Cause: pnpm's strict module
   layout versus Metro's bare-name imports. Fix: `publicHoistPattern` in
   `pnpm-workspace.yaml` plus `watchFolders`/`nodeModulesPaths` in
   `metro.config.js`.
2. **`[ERR_PNPM_IGNORED_BUILDS]` on a clean install.** `onlyBuiltDependencies`
   was rejected by pnpm 11; the correct key is `allowBuilds`. Now
   `@parcel/watcher` and `unrs-resolver` are the only two packages allowed to
   run install scripts, and a from-scratch install is clean.
3. **`expo-doctor` failed on dependency validation** because `app.config.ts`
   loaded the root `.env` with dotenv's banner on stdout, corrupting the output
   expo-doctor parses. Fix: `dotenv.config({ quiet: true })`.
4. **CORS rejected the app** when served from `127.0.0.1`, which is a different
   origin from `localhost`. `API_CORS_ORIGINS` now lists both, in `.env.example`
   and the local `.env`.

Three defects in the code itself were found by that verification and fixed:

- `Illegal invocation` on web: the client stored a bare `fetch` reference and
  called it as a method, which browsers reject. Now bound to `globalThis`.
- Requests that matched no route at all - for example `/does-not-exist` outside
  the versioned prefix - were assigned no request id, because the middleware was
  bound through `MiddlewareConsumer.forRoutes('*')`, which never sees unmatched
  requests. Now registered with `app.use()`, and covered by an e2e test.
- 404 bodies echoed the router's `Cannot GET /api/v1/does-not-exist`, disclosing
  routing internals. The filter now forwards a message only for exceptions that
  carry an explicit `code`; everything else becomes a status-appropriate generic
  message.

## Not done, and why

- PostgreSQL/Prisma - delivered in PHASE 2, see
  [`phase-02-database.md`](phase-02-database.md).
- No frontend unit test runner - no testable UI logic exists yet.
- No Git commit was made during PHASE 1; the first checkpoint is the PHASE 2
  commit.
- `PBL Template.pdf` (the original brief) is still in the working tree,
  unmodified.
- No Android device or iOS simulator run - only exports.

## Next step

PHASE 2 - Database: start PostgreSQL, add Prisma, write the schema, migrate,
seed, and surface database connectivity in `GET /health`. The first task should
be opening the app on a real Android device, since that is the one PHASE 1
promise that could not be verified here.

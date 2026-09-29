# HELPZY - Testing

## What exists now

| Layer          | Tool               | Location                         | Covers                                                                                              |
| -------------- | ------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unit           | Jest + ts-jest     | `backend/api/test/*.spec.ts`     | Environment resolution, shared config helpers                                                       |
| E2E            | Jest + supertest   | `backend/api/test/*.e2e-spec.ts` | The real HTTP surface: status codes, envelopes, headers, CORS, leak prevention, health dependencies |
| Contract       | Node script        | `scripts/smoke-api.mjs`          | Shared client against a **running** API                                                             |
| Static         | `tsc --noEmit`     | every workspace                  | Types, including test files                                                                         |
| Lint           | ESLint flat config | repository root                  | Correctness rules plus Prettier                                                                     |
| Project health | `expo-doctor`      | `apps/frontend`                  | 21 SDK/dependency/config checks                                                                     |
| Database       | Prisma             | `backend/api/prisma`             | Schema validation, `migrate dev`, `migrate reset`, idempotent seed                                  |

```bash
pnpm verify                  # format:check + lint + typecheck + unit + e2e
pnpm test:api                # unit only
pnpm test:e2e                # e2e only
pnpm smoke                   # live contract check, needs `pnpm dev:api` running
pnpm --filter @helpzy/frontend run doctor
pnpm --filter @helpzy/api run db:validate
```

Database checks that need a live PostgreSQL:

```bash
pnpm --filter @helpzy/api run db:generate   # stop the API first on Windows
pnpm --filter @helpzy/api run db:migrate    # applies pending migrations
pnpm --filter @helpzy/api run db:seed       # safe to re-run
pnpm --filter @helpzy/api run db:reset      # drops, re-applies, re-seeds
```

### Security headers and CORS

`backend/api/test/health.e2e-spec.ts` asserts, over real HTTP, that Helmet's
headers are present on `/health`, on a versioned 404 and on an unversioned 404,
and that CORS still works alongside them. The wildcard rule is a unit test
because it is a start-up failure, not an HTTP response:

```bash
pnpm test:api     # includes the API_CORS_ORIGINS wildcard rejection tests
```

## What each existing test protects

`backend/api/test/config.spec.ts` - the health route is the unversioned root
path; defaults apply when nothing is configured; trailing slashes are
normalised; and `API_CORS_ORIGINS` is parsed into an explicit list, trimmed, and
refuses a wildcard or the literal `null`.

`backend/api/test/health.e2e-spec.ts` - the full HTTP contract:

- `GET /health` returns 200 with the shared success envelope and a request id.
- Both named checks - `process` and `database` - are present and `UP`. The
  database probe is stubbed, so this suite needs no PostgreSQL.
- When the database probe fails, `/health` still answers 200 and reports
  `status: DOWN` with the `database` check down. Availability beats readiness.
- An inbound `x-request-id` is echoed in both the header and `meta`.
- `/api/v1/health` is 404, proving the exclusion works.
- Unknown routes, inside and outside the versioned prefix, return the typed
  error envelope, echo the request id, and never echo the router's
  `Cannot GET /x` message.
- A thrown internal error yields a generic 500 whose body contains neither the
  message nor a stack trace.
- CORS still works on errors, on preflight, and for unknown origins.
- Security headers are present on success and on both 404 shapes, and Helmet
  does not remove the CORS headers.

`scripts/smoke-api.mjs` - what the app actually does at runtime, against a live
process:

- `GET /health` responds and matches the shared Zod schema.
- Unversioned requests skip the `api/v1` prefix.
- Versioned requests get the typed error envelope.
- An unreachable API surfaces `ApiError` instead of hanging.

## Adding tests

**Backend unit test** - `backend/api/test/<name>.spec.ts`, plain Jest, globals
from `@types/jest`:

```ts
describe('my thing', () => {
  it('does the thing', () => {
    expect(myThing()).toBe(42);
  });
});
```

**Backend e2e test** - add to a feature spec. Build the app exactly as
`main.ts` does so tests cannot pass against a different configuration:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  // Override infrastructure providers so the suite does not need a live
  // PostgreSQL. Test both outcomes explicitly rather than depending on one.
  .overrideProvider(PrismaService)
  .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
  .compile();
app = moduleRef.createNestApplication();
configureApp(app, moduleRef.get<AppConfigRef>(APP_CONFIG));
await app.init();
```

Assert the whole contract, not just the happy path: status code, envelope shape,
error `code`, request id, and that internals are absent.

**Frontend** - there is no frontend test runner yet. `jest-expo` is added in the
first phase that ships logic worth unit-testing; until then the live checks
(`smoke`, `expo-doctor`, the three platform exports) are the frontend
verification, and the phase report says so explicitly.

## Manual verification for platform work

A bundle building is not a running app. For UI changes, verify all three:

```bash
pnpm dev:web       # and check the screen in the browser
pnpm dev:android   # on a device or emulator
pnpm dev:ios       # simulator, macOS only
```

Screenshots captured for PHASE 1 live in `docs/screenshots/`.

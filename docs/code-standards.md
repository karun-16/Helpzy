# HELPZY - Code Standards

Conventions are enforced by `eslint.config.mjs` and `prettier`, so this document
explains the _intent_ behind the mechanical rules.

## General

- TypeScript everywhere, `strict` on. No `any` in exported signatures; use
  `unknown` plus narrowing at the boundary.
- Files are `kebab-case.ts` (`api-client.ts`, `all-exceptions.filter.ts`).
- Imports are grouped: node built-ins, external, workspace packages, then
  relative. No import cycles between packages; `types` is the leaf.
- Comments explain _why_, not _what_. Every exported module has a short
  docstring stating its responsibility.
- No `console.log` in `apps/`, `backend/api/src` or `packages/`. The backend uses
  `Logger`; the app has no logging need yet.

## Naming

| Thing                          | Convention                | Example                              |
| ------------------------------ | ------------------------- | ------------------------------------ |
| Files                          | kebab-case                | `api-response.interceptor.ts`        |
| Components / classes           | PascalCase                | `StatusBadge`, `AllExceptionsFilter` |
| Functions, variables           | camelCase                 | `resolveApiBaseUrl`                  |
| Constants                      | SCREAMING_SNAKE           | `API_ERROR_CODES`                    |
| Types                          | PascalCase, no `I` prefix | `HealthResponseDto`                  |
| Zod schemas                    | `<thing>Schema`           | `healthResponseSchema`               |
| DTO types derived from schemas | `<thing>Dto`              | `HealthResponseDto`                  |

## API

- Feature modules live in `backend/api/src/<feature>/` and are registered in
  `app.module.ts` only. Never register a feature in a feature module.
- Product routes are served under `API_GLOBAL_PREFIX` (`api/v1`). Operational
  routes (`GET /health`) are added to the exclude list in `bootstrap.ts` and are
  reached with the client's unversioned methods.
- Validate input at the edge with a Zod schema; the service receives a typed
  object and re-validates only what it must trust.
- Throw `HttpException` subclasses with an explicit `code` when the client
  should see a specific message. The global filter strips anything else.
- Never return raw internal errors. The filter logs the stack and returns a
  generic message plus the request id.
- Security headers and CORS are configured once in `configureApp()` and nowhere
  else, in this order: request id, Helmet, global prefix, CORS. A new entry point
  must call that function, not rebuild the stack.
- Allowed browser origins come from `API_CORS_ORIGINS` and are always explicit.
  Never add a wildcard: the API is credentialed, so reflecting any origin would
  expose it to every site. Add the origin you need instead.
- Never add security middleware that is not needed by a shipped feature. Every
  header or guard has an owner and a reason in the phase report.

## Errors

- The client surfaces exactly one error type: `ApiError`, with
  `code`, `message`, `status`, `details` and `requestId`. Screens branch on
  `code`, never on message text.
- Transport failures become `ApiError.network` / `ApiError.timeout` so an
  offline backend renders the same "Unreachable" state as a 500.
- In the browser, `fetch` must be bound to its global
  (`globalThis.fetch.bind(globalThis)`), otherwise the call throws
  `Illegal invocation`.

## Frontend

- File-based routing under `src/app/`. `_layout.tsx` files own layout; a route
  file exports a default component and nothing else.
- Styling is NativeWind/Tailwind class names. No `StyleSheet.create` for visual
  styling; use inline styles only for platform-conditional values.
- Shared UI primitives go in `src/components/ui/` and receive `className`.
- Screens stay thin: data fetching in the screen or a `src/lib` hook, rendering
  in components, no `api.` calls inside presentational components.
- Public configuration is read from `lib/config.ts`, which reads Expo `extra`.
  Screens never touch `process.env`.
- Rules of Hooks are enforced by `eslint-plugin-react-hooks`. The one
  documented exception is the initial data fetch in an effect, where the state
  is set from a promise callback rather than synchronously.
- Call `AbortController` for anything that leaves the component, so a fast
  double-tap cannot resolve into a dead screen.

## Git

- Conventional-ish commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
  `test:`.
- One logical change per commit; formatting changes ride along with the change
  that needed them, never as their own commit.
- `.env` is never committed. `.env.example` changes always accompany a
  behaviour change in configuration.
- A phase ends with a checkpoint commit, and the phase report is updated in the
  same commit. The report states what was verified and what was left out.
- Seed data may be committed; real credentials, tokens, keys and certificates
  may not. Development fixture passwords belong in documentation, never in a
  deployment file.

## Before opening a pull request

```bash
pnpm verify   # format:check + lint + typecheck + unit + e2e
```

If the change touches the API contract or the app's runtime behaviour, also run:

```bash
pnpm dev:api          # in one terminal
pnpm smoke            # in another
```

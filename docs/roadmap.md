# HELPZY - Roadmap

Delivery is phased, and each phase ends with a working app plus a status report.
A phase is not complete because code exists; it is complete when it is verified.

## PHASE 1 - Foundation - complete

Monorepo, tooling, shared packages, environment contract, NestJS health
endpoint, and one Expo app running on web, Android and iOS.
Report: [`phase-01-foundation.md`](phase-01-foundation.md).

## PHASE 2 - Database - complete

- PostgreSQL 18 instance and `DATABASE_URL` wired through the existing config.
- Prisma schema for `User`, `ProfessionalProfile`, `ServiceCategory`, `Service`,
  `Booking`, `Payment`, `Review`, `Address`, plus the enums the domain needs.
- First migration plus an idempotent seed script with development fixtures.
- A `PrismaService` in the API with health impact wired into `GET /api/v1/health`.

Report: [`phase-02-database.md`](phase-02-database.md).

## PHASE 3 - Authentication

- Registration, login, refresh, logout; password hashing with argon2id.
  The Phase 2 seed uses SHA-256 as a placeholder and is replaced here.
- Roles: `CUSTOMER`, `PROFESSIONAL`, `ADMIN`, enforced in a guard and in the
  schema.
- Session storage in the app behind `packages/api-client`'s `getAuthToken`.

Exit criteria: e2e tests cover register, login, refresh, logout, rejection of bad
credentials, and role-gated access.

## PHASE 4 - Service catalogue

- Categories, services, provider listings, search with filters and pagination.
- Public read endpoints plus provider-managed writes.
- Catalogue screens in the app: browse, search, filter, service detail.

Exit criteria: a customer can find a service on all three platforms against
paged API results; e2e tests cover filtering, pagination and authorisation.

## PHASE 5 - Booking

- Availability rules, slot computation, booking lifecycle state machine.
- Customer booking flow and provider schedule management.
- Cancellation and rescheduling rules, enforced server-side.
- Revisit the Phase 2 constraint `@@unique([professionalId, scheduledStart])`:
  it assumes a fixed slot length, so services with different durations need an
  overlap check rather than an equality check.

Exit criteria: double-booking is impossible under concurrent requests; the state
machine is covered by tests; the booking screens are usable on a small screen.

## PHASE 6 - Provider onboarding

- Provider profile, services, pricing, portfolio images.
- Verification workflow and admin review queue.

Exit criteria: a provider can complete onboarding and publish a first service
without help; unverified providers are hidden from search.

## PHASE 7 - Payments, reviews, notifications

- Payment intent creation, webhook handling, idempotency, refunds.
- Reviews with moderation, and notifications for booking lifecycle events.

Exit criteria: webhook retries cannot double-book or double-pay; notifications
are observable in an in-app inbox.

## PHASE 8 - Hardening and release

- Accessibility pass (contrast, focus order, screen-reader labels, dynamic type).
- Performance budgets, image handling, caching, bundle size review.
- Deployment, environment separation, backups, runbook.

Exit criteria: documented runbook, measured budgets met, release checklist
signed off.

## Working rules for every phase

1. Ask before doing anything the phase list does not include.
2. Prove the work: lint, typecheck, tests, and a real run on all three
   platforms, or say plainly that it was not verified.
3. Finish with the status report, including what failed and what was left out.
4. Never weaken lint, typecheck or a test to make a phase pass.

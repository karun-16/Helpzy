/**
 * Shared e2e harness for the rescheduling, completion, payment and verification
 * document flows.
 *
 * These features are exercised together because they share one booking and one
 * payment row, and because the interesting failures are the ones that span two
 * of them: a cash payment that settles on one confirmation, a callback that pays
 * twice, a proposal that moves an appointment nobody agreed to.
 *
 * The Prisma doubles model the two things the services genuinely rely on:
 * guarded `updateMany` calls (which express a lost race as `count: 0`) and the
 * unique constraint behind webhook idempotency.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac } from 'node:crypto';

import { AppModule } from '../../src/app.module';
import { DEMO_ADMIN_MFA_CODE } from '../../src/auth/auth.service';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { PlatformSettingsService } from '../../src/platform-settings/platform-settings.service';
import { APP_CONFIG, type AppConfigRef } from '../../src/config/app-config.token';

export const CUSTOMER_ID = 'b1000000-0000-4000-8000-000000000001';
export const PROFESSIONAL_USER_ID = 'b2000000-0000-4000-8000-000000000001';
export const ADMIN_ID = 'b4000000-0000-4000-8000-000000000001';
export const BOOKING_ID = 'b5000000-0000-4000-8000-000000000001';
export const PROFILE_ID = 'b3000000-0000-4000-8000-000000000001';
export const PAYMENT_ID = 'b9000000-0000-4000-8000-000000000001';
export const CATEGORY_ID = 'c0000000-0000-4000-8000-000000000001';
export const ADDRESS_ID = 'ba000000-0000-4000-8000-000000000001';

/** The names the harness's doubles return, keyed by the id they are asked for. */
const USER_NAMES: Record<string, string> = {
  [CUSTOMER_ID]: 'Rahul Verma',
  [PROFESSIONAL_USER_ID]: 'Meera Iyer',
  [ADMIN_ID]: 'Aditi Rao',
};

export const WEBHOOK_SECRET = 'helpzy-development-webhook-secret';

export type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/** Hours from now, so a proposed slot is always in the future. */
export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);

const decimal = (value: number) => ({ toNumber: () => value });

export interface Harness {
  app: INestApplication;
  api: () => request.Agent;
  as: (role: Role) => { Authorization: string };
  state: {
    booking: Record<string, unknown> | null;
    payment: Record<string, unknown> | null;
    proposal: Record<string, unknown> | null;
    documents: Array<Record<string, unknown>>;
    documentReviews: Array<Record<string, unknown>>;
    /** The address the last booking was saved against. */
    address: Record<string, unknown> | null;
    /** The bookable service `service.findFirst` offers, once one is installed. */
    bookableService: Record<string, unknown> | null;
  };
  baseBooking: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  basePayment: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  auditLog: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  history: Array<{ fromStatus: string | null; toStatus: string }>;
  attempts: Array<Record<string, unknown>>;
  webhookEvents: Map<string, Record<string, unknown>>;
  /**
   * The Prisma doubles, typed loosely on purpose: a test reaches for a specific
   * model's mock to assert a write never happened.
   */
  prisma: Record<string, Record<string, jest.Mock>>;
  /**
   * A named model's mock, e.g. `model('user')`, so a test can assert that a
   * particular write never happened.
   */
  model: (name: string) => Record<string, jest.Mock>;
  /**
   * One method double on one model, e.g. `modelMethod('service', 'create')`.
   *
   * Separate from `model` because the doubles are typed as a plain record, and
   * under `noUncheckedIndexedAccess` a lookup on one is `jest.Mock | undefined`
   * however obviously the key is present. This narrows once - in the harness that
   * already throws for an unknown model - rather than at every call site.
   */
  modelMethod: (name: string, method: string) => jest.Mock;
  /** The `user.findUnique` double, stubbed by the login helper. */
  userFindUnique: jest.Mock;
  /**
   * Clears the stored settings row *and* the service cache, returning the app to
   * the pre-settings state.
   */
  resetSettings: () => void;
  /**
   * Makes a customer booking actually creatable: an active customer, a bookable
   * service and an address to save it against.
   *
   * Opt-in rather than the default, because the doubles that answer "does this
   * service exist" also answer "may this professional edit this listing", and a
   * suite that expects *not found* must keep getting it. A settings test that
   * needs to prove an enforcement rule only has to prove the rule was reached,
   * though - and reaching it means the request surviving the request schema, so
   * it turns this on.
   */
  enableBookableService: () => void;
  /** Signs a webhook body the way the sandbox gateway does. */
  sign: (body: string) => string;
}

/** Starts the API with the Prisma doubles and returns the shared state. */
export async function createBookingFlowsHarness(): Promise<Harness> {
  const auditLog: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const history: Array<{ fromStatus: string | null; toStatus: string }> = [];
  const attempts: Array<Record<string, unknown>> = [];
  /** The single settings row, or null before anything has been saved. */
  let savedSettings: {
    id: string;
    document: unknown;
    updatedById: string | null;
  } | null = null;
  const webhookEvents = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, string>();

  const state = {
    booking: null as Record<string, unknown> | null,
    payment: null as Record<string, unknown> | null,
    proposal: null as Record<string, unknown> | null,
    documents: [] as Array<Record<string, unknown>>,
    documentReviews: [] as Array<Record<string, unknown>>,
    address: null as Record<string, unknown> | null,
    bookableService: null as Record<string, unknown> | null,
  };

  const baseBooking = (overrides: Record<string, unknown> = {}) => ({
    id: BOOKING_ID,
    reference: 'HZ-TEST-0001',
    customerId: CUSTOMER_ID,
    professionalId: PROFILE_ID,
    status: 'SCHEDULED',
    scheduledStart: hoursFromNow(48),
    scheduledEnd: hoursFromNow(49),
    createdAt: new Date(),
    customerNote: null,
    address: null,
    review: null,
    // Mirrors a Prisma Decimal: the service calls `toNumber()` on it.
    service: {
      id: CATEGORY_ID,
      title: 'Deep clean',
      basePrice: { toNumber: () => 1000 },
      currency: 'INR',
      durationMinutes: 60,
    },
    professional: {
      id: PROFILE_ID,
      userId: PROFESSIONAL_USER_ID,
      user: { id: PROFESSIONAL_USER_ID, fullName: 'Meera Iyer' },
      businessName: 'Meera Iyer Home Care',
    },
    customer: { id: CUSTOMER_ID, fullName: 'Rahul Verma' },
    /*
     * The price agreed when the booking was made.
     *
     * Deliberately different from `service.basePrice` below. A payment reads the
     * booking's snapshot, never the listing's live price, so a harness that gave
     * the two the same number would make that distinction untestable - a test
     * changing `basePrice` must not change what the customer is charged.
     */
    priceAmount: decimal(1250),
    currency: 'INR',
    rescheduleRequestId: null,
    rescheduleReturnStatus: null,
    completedByProfessionalId: null,
    completedByProfessionalAt: null,
    completedByCustomerId: null,
    completedByCustomerAt: null,
    completedByProfessional: null,
    completedByCustomer: null,
    ...overrides,
  });

  const basePayment = (overrides: Record<string, unknown> = {}) => ({
    id: PAYMENT_ID,
    bookingId: BOOKING_ID,
    amount: decimal(1000),
    currency: 'INR',
    method: 'ONLINE',
    status: 'PENDING',
    provider: null,
    failureReason: null,
    paidAt: null,
    createdAt: new Date(),
    gatewayTransactionId: null,
    gatewayMethod: null,
    gatewayVerified: false,
    cashConfirmedByCustomerId: null,
    cashConfirmedByCustomerAt: null,
    cashConfirmedByCustomer: null,
    cashConfirmedByProfessionalId: null,
    cashConfirmedByProfessionalAt: null,
    cashConfirmedByProfessional: null,
    ...overrides,
  });

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    booking: {
      /**
       * Honours the ownership filters the services use to prove a booking
       * belongs to the caller, so a test can prove a non-party is refused.
       *
       * The reschedule service scopes with an `OR` of the two parties, which is
       * the shape Prisma uses for "customer or assigned professional".
       */
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where?: Record<string, unknown>;
          select?: Record<string, unknown>;
        } = {}) => {
          const row = state.booking;
          if (!row) return null;
          if (where?.id && row.id !== where.id) return null;
          if (where?.status && row.status !== where.status) return null;

          const alternatives = where?.OR as Array<Record<string, unknown>> | undefined;
          if (alternatives) {
            const matches = alternatives.some((clause) => {
              if (clause.customerId) return row.customerId === clause.customerId;
              const professional = clause.professional as { userId?: string } | undefined;
              if (professional?.userId) {
                return (row.professional as { userId: string }).userId === professional.userId;
              }
              return false;
            });
            if (!matches) return null;
          }

          if (where?.customerId && row.customerId !== where.customerId) return null;
          if (where?.professionalId && row.professionalId !== where.professionalId) return null;
          const professional = where?.professional as { userId?: string } | undefined;
          if (professional?.userId) {
            if ((row.professional as { userId: string }).userId !== professional.userId) {
              return null;
            }
          }

          /**
           * Attach the relations the caller asked to `select`, reading them from
           * the live state so a nested `payment` is never a stale snapshot.
           * Prisma returns only the selected fields, but the doubles keep the full
           * row, which is harmless for these assertions.
           */
          const resolved: Record<string, unknown> = { ...row };
          const requested = { ...(where ?? {}), ...(select ?? {}) };
          if ('payment' in requested) resolved.payment = state.payment;
          if ('service' in requested) resolved.service = row.service;
          if ('customer' in requested) resolved.customer = row.customer;
          if ('professional' in requested) resolved.professional = row.professional;
          return resolved;
        },
      ),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => state.booking),
      /**
       * Returns the row with the relations the caller asked to `include`, so a
       * created booking can be mapped straight to its DTO. Deliberately does not
       * touch `state.booking`: a test asserting that a *particular* booking was
       * written reads the call history, and overwriting the seeded row would
       * quietly change what every later lookup in that test finds.
       */
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = baseBooking({
          ...data,
          status: 'REQUESTED',
          customerNote: (data.customerNote as string | undefined) ?? null,
          address: state.address,
        });
        return row;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.booking) Object.assign(state.booking, data);
        return state.booking;
      }),
      /**
       * Models a guarded update: a status, ownership or proposal mismatch matches
       * nothing, which is how a lost race reaches the service as `count: 0`.
       */
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!state.booking) return { count: 0 };
          if (where.status && state.booking.status !== where.status) return { count: 0 };
          if ('rescheduleRequestId' in where) {
            const expected = where.rescheduleRequestId;
            if (expected === null && state.booking.rescheduleRequestId !== null) {
              return { count: 0 };
            }
            if (expected && state.booking.rescheduleRequestId !== expected) return { count: 0 };
          }
          Object.assign(state.booking, data);
          return { count: 1 };
        },
      ),
      count: jest.fn().mockResolvedValue(0),
    },
    bookingStatusHistory: {
      create: jest.fn(
        async ({ data }: { data: { fromStatus: string | null; toStatus: string } }) => {
          history.push({ fromStatus: data.fromStatus, toStatus: data.toStatus });
          return data;
        },
      ),
      findMany: jest.fn(async () => history),
    },
    rescheduleRequest: {
      findFirst: jest.fn(async () => state.proposal),
      findUnique: jest.fn(async () => state.proposal),
      findMany: jest.fn(async () => (state.proposal ? [state.proposal] : [])),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.proposal = {
          id: 'b6000000-0000-4000-8000-000000000001',
          bookingId: BOOKING_ID,
          reason: null,
          status: 'PENDING',
          decisionNote: null,
          decidedById: null,
          decidedAt: null,
          createdAt: new Date(),
          requestedBy: { id: CUSTOMER_ID, fullName: 'Rahul Verma', role: 'CUSTOMER' },
          decidedBy: null,
          ...data,
        };
        return state.proposal;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!state.proposal || state.proposal.status !== where.status) return { count: 0 };
          Object.assign(state.proposal, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async () => state.proposal),
    },

    payment: {
      /**
       * Scoped through the booking when the caller filters on it, so a payment can
       * only be read by a party to its booking.
       */
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where?: Record<string, unknown>;
          select?: Record<string, unknown>;
        } = {}) => {
          const payment = state.payment;
          if (!payment) return null;
          if (where?.bookingId && payment.bookingId !== where.bookingId) return null;

          const booking = where?.booking as
            { customerId?: string; professional?: { userId?: string } } | undefined;
          if (booking) {
            if (booking.customerId && state.booking?.customerId !== booking.customerId) {
              return null;
            }
            if (booking.professional?.userId) {
              const owner = (state.booking?.professional as { userId?: string } | undefined)
                ?.userId;
              if (owner !== booking.professional.userId) return null;
            }
          }

          // The DTOs read the booking reference off the payment, and the
          // webhook handler reads the customer id to address a failure
          // notification, so the relation is resolved here rather than
          // left undefined.
          const resolved: Record<string, unknown> = { ...payment };
          if ('booking' in (select ?? {}) || where?.booking) {
            resolved.booking = {
              reference: state.booking?.reference,
              customerId: state.booking?.customerId,
              status: state.booking?.status,
            };
          }
          if ('attempts' in (select ?? {})) resolved.attempts = attempts;
          return resolved;
        },
      ),
      findUnique: jest.fn(async () => state.payment),
      findUniqueOrThrow: jest.fn(async () => {
        if (!state.payment) throw new Error('payment not found');
        return state.payment;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.payment) Object.assign(state.payment, data);
        return state.payment;
      }),
      /**
       * Mirrors both guards the service depends on: "not already paid", and "this
       * party's cash confirmation column is still empty".
       */
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (!state.payment) return { count: 0 };
          // A plain equality filter, as used when a refund claims a payment that is
          // still PAID: a payment in any other state matches nothing.
          if (typeof where.status === 'string' && state.payment.status !== where.status) {
            return { count: 0 };
          }
          // Matches Prisma's `{ not: value }` filter on its contents, not by
          // reference: the service guards with `{ status: { not: 'PAID' } }`.
          const statusFilter = where.status as { not?: string; in?: readonly string[] } | undefined;
          if (statusFilter?.not && state.payment.status === statusFilter.not) {
            return { count: 0 };
          }
          /*
           * The in-flight claim: the service writes through
           * `{ status: { in: ['PENDING', 'PROCESSING'] } }`, so a payment that has
           * already reached an outcome - paid, failed, refunded or held by a dispute
           * - matches nothing. Honoured here or the double would let a late write
           * through that a real database rejects.
           */
          if (statusFilter?.in && !statusFilter.in.includes(state.payment.status as string)) {
            return { count: 0 };
          }
          if (where.cashConfirmedByCustomerId === null && state.payment.cashConfirmedByCustomerId) {
            return { count: 0 };
          }
          if (
            where.cashConfirmedByProfessionalId === null &&
            state.payment.cashConfirmedByProfessionalId
          ) {
            return { count: 0 };
          }
          Object.assign(state.payment, data);
          return { count: 1 };
        },
      ),
      /** Applies `update` for an existing row and `create` for a new one. */
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          if (!state.payment) {
            state.payment = basePayment(create);
            return state.payment;
          }
          Object.assign(state.payment, update);
          return state.payment;
        },
      ),
    },
    paymentAttempt: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        attempts.push({ createdAt: new Date(), ...data });
        return data;
      }),
      findMany: jest.fn(async () => attempts),
    },
    paymentWebhookEvent: {
      /**
       * Throws the unique violation the service catches, which is what makes a
       * retried callback a no-op rather than a second payment.
       */
      create: jest.fn(async ({ data }: { data: { providerEventId: string } }) => {
        if (webhookEvents.has(data.providerEventId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `wh-${webhookEvents.size + 1}`, ...data };
        webhookEvents.set(data.providerEventId, row);
        return row;
      }),
      /**
       * The idempotency read: a callback whose event id is already recorded is
       * a duplicate, so the service returns before writing anything.
       */
      findUnique: jest.fn(
        async ({ where }: { where: { providerEventId: string } }) =>
          webhookEvents.get(where.providerEventId) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { providerEventId: string };
          data: Record<string, unknown>;
        }) => {
          const row = webhookEvents.get(where.providerEventId);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    },

    professionalProfile: {
      findUnique: jest.fn(async () => ({ id: PROFILE_ID, verification: 'UNVERIFIED' })),
      findFirst: jest.fn(async () => ({ id: PROFILE_ID })),
      findUniqueOrThrow: jest.fn(async () => ({ id: PROFILE_ID, verification: 'UNVERIFIED' })),
      findMany: jest.fn(async () => []),
      count: jest.fn().mockResolvedValue(0),
      // Present so a test can assert the API never writes it from a document
      // upload: only the separate admin verification action may set a badge.
      update: jest.fn(),
    },
    verificationDocument: {
      findMany: jest.fn(async () => state.documents),
      findUnique: jest.fn(
        async ({
          select,
        }: {
          where?: Record<string, unknown>;
          select?: Record<string, unknown>;
        } = {}) => {
          const row = state.documents[0];
          if (!row) return null;
          // The review notification is addressed to the document's owner.
          const resolved: Record<string, unknown> = { ...row };
          if (select && 'professional' in select) {
            resolved.professional = { userId: PROFESSIONAL_USER_ID };
          }
          return resolved;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'b7000000-0000-4000-8000-000000000001',
          status: 'PENDING',
          rejectionReason: null,
          reviewedAt: null,
          reviewedById: null,
          submittedAt: new Date(),
          reviewedBy: null,
          reviews: [],
          ...data,
        };
        state.documents = [row, ...state.documents];
        return row;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const row = state.documents[0];
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async () => state.documents[0]),
    },
    verificationDocumentReview: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.documentReviews.push(data);
        return data;
      }),
    },
    address: {
      /** Only the id is read back, so the double keeps just that much of it. */
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.address = { id: ADDRESS_ID, ...data };
        return state.address;
      }),
      findFirst: jest.fn(async () => (state.address ? { id: state.address.id } : null)),
    },
    serviceCategory: {
      findUnique: jest.fn(async () => ({
        id: CATEGORY_ID,
        name: 'Home Cleaning',
        isActive: true,
      })),
      // The public marketplace lists categories that have a bookable service; the
      // harness has none unless a test installs one, so the default is an empty
      // list rather than a fabricated category a test would then have to filter
      // around.
      findMany: jest.fn(async () => []),
    },
    service: {
      findFirst: jest.fn(async () => state.bookableService),
      // Undefined by default: the slug a create derives must be free.
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'b8000000-0000-4000-8000-000000000001',
        title: data.title,
        slug: data.slug,
        summary: (data.summary as string | undefined) ?? null,
        description: data.description,
        // Mirrors a Prisma Decimal: the service calls `toNumber()` on it.
        basePrice: decimal(Number(data.priceAmount)),
        currency: data.currency,
        durationMinutes: data.durationMinutes,
        isActive: data.isActive,
        moderationNote: null,
        category: { id: CATEGORY_ID, slug: 'home-cleaning', name: 'Home Cleaning' },
        _count: { bookings: 0 },
      })),
    },
    /*
     * Absent from the mock, the settings service would fall back to its defaults on
     * every read and log an error each time. Present and null, it reads as "no row
     * saved yet", which is the real pre-settings state and keeps the suite quiet.
     */
    /*
     * Stateful, so a settings change an admin saves is actually the document the
     * next request reads. Without this, `upsert` would succeed and the following
     * enforcement check would silently read the defaults again - which would make
     * every settings enforcement test pass for the wrong reason.
     */
    platformSetting: {
      findUnique: jest.fn(async () => (savedSettings ? { ...savedSettings } : null)),
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          create?: Record<string, unknown>;
          update?: Record<string, unknown>;
        }) => {
          savedSettings = {
            id: 'MAIN',
            document: update?.document ?? create?.document,
            updatedById:
              (update?.updatedById as string | undefined) ??
              (create?.updatedById as string | undefined) ??
              null,
          };
          const updatedById = savedSettings.updatedById;
          return {
            ...savedSettings,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            /*
             * Prisma resolves the relation, so the admin's name is what comes back.
             * An admin screen that cannot say who last changed a setting cannot ask
             * the useful follow-up question.
             */
            updatedBy: updatedById ? { fullName: USER_NAMES[updatedById] ?? null } : null,
          };
        },
      ),
    },
    review: { findUnique: jest.fn() },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLog.push(data);
        return data;
      }),
      findMany: jest.fn(async () => auditLog),
    },
    notification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data);
        return data;
      }),
      findMany: jest.fn(async () => []),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const transaction = { ...prisma };

  /** The doubles for one model, refusing an unknown name rather than returning undefined. */
  const modelDoubles = (name: string): Record<string, jest.Mock> => {
    const found = prisma[name as keyof typeof prisma];
    if (!found) throw new Error(`unknown model: ${name}`);
    return found as Record<string, jest.Mock>;
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn((operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
      ...prisma,
    })
    .compile();

  const app = moduleRef.createNestApplication();
  const config = moduleRef.get<AppConfigRef>(APP_CONFIG);
  configureApp(app, config);
  // The gateway tests need a provider to be configured, because the API
  // deliberately refuses to open a checkout when none is - that refusal is
  // itself asserted by the existing marketplace suite.
  config.paymentOnlineProvider = 'sandbox';
  await app.init();

  const loginAs = async (user: { id: string; phone: string; fullName: string; role: Role }) => {
    // The login flow stubs this one query.
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      email: `${user.role.toLowerCase()}@helpzy.test`,
      status: 'ACTIVE',
      passwordHash: 'hashed',
    });
    const otp = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: user.phone })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: user.phone, otp: otp.body.data.otp })
      .expect(200);

    let token = login.body.data.token as string;
    if (user.role === 'ADMIN') {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: DEMO_ADMIN_MFA_CODE })
        .expect(200);
      token = challenge.body.data.token as string;
    }
    tokens.set(user.role, token);
    return token;
  };

  await loginAs({
    id: CUSTOMER_ID,
    phone: '+919800000002',
    fullName: 'Rahul Verma',
    role: 'CUSTOMER',
  });
  await loginAs({
    id: PROFESSIONAL_USER_ID,
    phone: '+919800000003',
    fullName: 'Meera Iyer',
    role: 'PROFESSIONAL',
  });
  await loginAs({ id: ADMIN_ID, phone: '+919800000001', fullName: 'Aditi Rao', role: 'ADMIN' });

  const harness: Harness = {
    app,
    api: () => request(app.getHttpServer()),
    as: (role) => ({ Authorization: `Bearer ${tokens.get(role)}` }),
    state,
    baseBooking,
    basePayment,
    auditLog,
    notifications,
    history,
    attempts,
    webhookEvents,
    prisma,
    model: modelDoubles,
    modelMethod: (name: string, method: string) => modelDoubles(name)[method]!,
    userFindUnique: prisma.user.findUnique,
    /**
     * Returns the app to "no settings saved" state.
     *
     * Both halves matter: the settings service caches the document for a short
     * window, so resetting only the row would let one test's settings leak into the
     * next.
     */
    resetSettings: () => {
      savedSettings = null;
      app.get(PlatformSettingsService).invalidate();
    },
    enableBookableService: () => {
      state.address = {
        id: ADDRESS_ID,
        userId: CUSTOMER_ID,
        label: 'Home',
        line1: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
      };
      state.bookableService = {
        id: 'b8000000-0000-4000-8000-000000000001',
        title: 'Deep clean',
        summary: null,
        durationMinutes: 120,
        basePrice: decimal(800),
        currency: 'INR',
        category: { id: CATEGORY_ID, slug: 'home-cleaning', name: 'Home Cleaning' },
        owner: {
          id: PROFESSIONAL_USER_ID,
          fullName: 'Meera Iyer',
          professionalProfile: { id: PROFILE_ID },
        },
      };
      // Scoped by id so a lookup for anything else still misses.
      prisma.service.findFirst.mockImplementation(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id && where.id !== state.bookableService?.id) return null;
          return state.bookableService;
        },
      );
      prisma.user.findFirst.mockImplementation(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          const id = where?.id as string | undefined;
          if (!id || !USER_NAMES[id]) return null;
          return { id, fullName: USER_NAMES[id] };
        },
      );
    },
    sign: (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'),
  };

  return harness;
}

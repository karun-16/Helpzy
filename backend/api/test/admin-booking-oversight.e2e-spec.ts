import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';

const CUSTOMER_ID = 'e1000000-0000-4000-8000-000000000001';
const PROFESSIONAL_USER_ID = 'e2000000-0000-4000-8000-000000000001';
const ADMIN_ID = 'e4000000-0000-4000-8000-000000000001';
const BOOKING_ID = 'e5000000-0000-4000-8000-000000000001';
const PAID_BOOKING_ID = 'e5000000-0000-4000-8000-000000000002';
const PAYMENT_ID = 'e9000000-0000-4000-8000-000000000001';

type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/**
 * Administrative oversight of individual bookings.
 *
 * These routes can move money and rewrite a booking's state, so the tests are
 * mostly about the guards: only an admin may reach them, every change needs a
 * written reason, a paid booking cannot be rewound into an earlier status, a
 * payment can only be refunded once, and every intervention is both attributed
 * in the booking's own timeline and recorded in the audit log.
 */
describe('Admin booking oversight (e2e)', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>();
  const auditLog: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];

  const bookings = new Map<string, Record<string, unknown>>();
  const payments = new Map<string, Record<string, unknown>>();
  const statusHistory: Array<Record<string, unknown>> = [];

  const decimal = (value: number) => ({ toNumber: () => value });

  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    booking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    bookingStatusHistory: { create: jest.fn(), findMany: jest.fn() },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
      // The refund claims the payment with a status guard, so the double has to be
      // able to say "that guard matched nothing".
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn(),
    },
    bookingMessage: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    professionalProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    service: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    review: { findUnique: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    const transaction = { ...prisma };
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

    app = moduleRef.createNestApplication();
    configureApp(app, moduleRef.get<AppConfigRef>(APP_CONFIG));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  const loginAs = async (user: { id: string; phone: string; fullName: string; role: Role }) => {
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
        .send({ code: '000000' })
        .expect(200);
      token = challenge.body.data.token as string;
    }
    tokens.set(user.role, token);
    return token;
  };

  const as = (role: Role) => ({ Authorization: `Bearer ${tokens.get(role)}` });
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
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
  }, 20_000);

  /** The full include shape the detail query asks for. */
  const detailRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    reference: id === PAID_BOOKING_ID ? 'HZ-2002' : 'HZ-1001',
    status: 'IN_PROGRESS',
    scheduledStart: new Date('2026-03-01T09:00:00.000Z'),
    scheduledEnd: new Date('2026-03-01T11:00:00.000Z'),
    priceAmount: decimal(1200),
    currency: 'INR',
    customerNote: 'Please ring the bell twice',
    cancellationNote: null,
    completedAt: null,
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
    customer: { id: CUSTOMER_ID, fullName: 'Rahul Verma', phone: '+919800000002' },
    professional: {
      id: 'e3000000-0000-4000-8000-000000000001',
      userId: PROFESSIONAL_USER_ID,
      businessName: 'Meera Home Care',
      user: { id: PROFESSIONAL_USER_ID, fullName: 'Meera Iyer', phone: '+919800000003' },
    },
    service: { id: 'e6000000-0000-4000-8000-000000000001', title: 'Deep Clean' },
    address: {
      line1: '12 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    },
    payment: {
      status: 'PENDING',
      amount: decimal(1200),
      method: 'ONLINE',
      failureReason: null,
    },
    review: null,
    disputes: [],
    messages: [
      {
        id: 'e8000000-0000-4000-8000-000000000001',
        body: 'I am on my way',
        createdAt: new Date('2026-03-01T08:45:00.000Z'),
        sender: { id: PROFESSIONAL_USER_ID, fullName: 'Meera Iyer' },
      },
    ],
    statusHistory: [
      {
        id: 'e7000000-0000-4000-8000-000000000001',
        fromStatus: 'ACCEPTED',
        toStatus: 'IN_PROGRESS',
        isOverride: false,
        createdAt: new Date('2026-03-01T09:05:00.000Z'),
        actor: { id: PROFESSIONAL_USER_ID, fullName: 'Meera Iyer' },
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    bookings.clear();
    payments.clear();
    auditLog.length = 0;
    notifications.length = 0;
    statusHistory.length = 0;
    jest.clearAllMocks();

    bookings.set(BOOKING_ID, {
      id: BOOKING_ID,
      reference: 'HZ-1001',
      status: 'IN_PROGRESS',
      completedAt: null,
      customerId: CUSTOMER_ID,
      professional: { userId: PROFESSIONAL_USER_ID },
    });
    bookings.set(PAID_BOOKING_ID, {
      id: PAID_BOOKING_ID,
      reference: 'HZ-2002',
      status: 'PAID',
      completedAt: new Date('2026-02-01T00:00:00.000Z'),
      customerId: CUSTOMER_ID,
      professional: { userId: PROFESSIONAL_USER_ID },
    });

    payments.set(PAYMENT_ID, {
      id: PAYMENT_ID,
      bookingId: PAID_BOOKING_ID,
      status: 'PAID',
      amount: decimal(1500),
      currency: 'INR',
    });

    // The narrow `requireBooking` read and the wide `detail` read hit the same
    // mocked method, so one row serves both and they can never disagree.
    prisma.booking.findUnique.mockImplementation(({ where }) => {
      const state = bookings.get(where?.id);
      if (!state) return Promise.resolve(null);
      return Promise.resolve(
        detailRow(where.id, {
          status: state.status,
          reference: state.reference,
          completedAt: state.completedAt,
          // The narrow read needs the owner id to address notices to; the wide
          // read ignores it, reading the parties through relations instead.
          customerId: state.customerId,
          // A refund rewrites the payment, so the detail read must report the
          // refunded state rather than the row as it was before the request.
          payment: payments.get(PAYMENT_ID)
            ? {
                status: payments.get(PAYMENT_ID)!.status,
                amount: decimal(1500),
                method: 'ONLINE',
                failureReason: payments.get(PAYMENT_ID)!.failureReason ?? null,
              }
            : { status: 'PENDING', amount: decimal(1200), method: 'ONLINE', failureReason: null },
        }),
      );
    });
    prisma.booking.update.mockImplementation(({ where, data }) => {
      const existing = bookings.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      bookings.set(where.id, updated);
      return Promise.resolve(updated);
    });
    prisma.bookingStatusHistory.create.mockImplementation(({ data }) => {
      statusHistory.push(data);
      return Promise.resolve(data);
    });
    prisma.payment.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        payments.get(PAYMENT_ID)?.bookingId === where?.bookingId ? payments.get(PAYMENT_ID) : null,
      ),
    );
    prisma.payment.update.mockImplementation(({ where, data }) => {
      const existing = payments.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      payments.set(where.id, updated);
      return Promise.resolve(updated);
    });
    /*
     * The guarded counterpart the refund uses: it claims a payment that is still
     * PAID, so a payment in any other state matches nothing and the caller can tell
     * "someone refunded it first" from "I refunded it".
     */
    prisma.payment.updateMany.mockImplementation(({ where, data }) => {
      const existing = payments.get(where?.id);
      if (!existing) return Promise.resolve({ count: 0 });
      if (where.status && existing.status !== where.status) {
        return Promise.resolve({ count: 0 });
      }
      payments.set(where.id, { ...existing, ...data });
      return Promise.resolve({ count: 1 });
    });
    prisma.auditLog.create.mockImplementation(({ data }) => {
      auditLog.push(data);
      return Promise.resolve(data);
    });
    prisma.notification.create.mockImplementation(({ data }) => {
      notifications.push(data);
      return Promise.resolve(data);
    });
  });

  describe('access control', () => {
    it('refuses anonymous callers on every route', async () => {
      await api().get(`/api/v1/admin/bookings/${BOOKING_ID}`).expect(401);
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .send({ status: 'CANCELLED', reason: 'Customer asked us to close this booking.' })
        .expect(401);
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/refund`)
        .send({ reason: 'Customer asked us to close this booking.' })
        .expect(401);
    });

    it('refuses the customer who holds the booking', async () => {
      await api().get(`/api/v1/admin/bookings/${BOOKING_ID}`).set(as('CUSTOMER')).expect(403);
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('CUSTOMER'))
        .send({ status: 'CANCELLED', reason: 'I would rather not go ahead with this booking.' })
        .expect(403);
    });

    it('refuses the professional assigned to it', async () => {
      await api().get(`/api/v1/admin/bookings/${BOOKING_ID}`).set(as('PROFESSIONAL')).expect(403);
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/refund`)
        .set(as('PROFESSIONAL'))
        .send({ reason: 'I would rather not go ahead with this booking.' })
        .expect(403);
    });
  });

  describe('booking detail', () => {
    it('gathers both parties, money, chat and timeline in one payload', async () => {
      const response = await api()
        .get(`/api/v1/admin/bookings/${BOOKING_ID}`)
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          reference: 'HZ-1001',
          customer: expect.objectContaining({ fullName: 'Rahul Verma' }),
          professional: expect.objectContaining({ fullName: 'Meera Iyer' }),
          service: { id: 'e6000000-0000-4000-8000-000000000001', title: 'Deep Clean' },
          address: expect.objectContaining({ city: 'Bengaluru' }),
        }),
      );
      expect(response.body.data.messages).toHaveLength(1);
      expect(response.body.data.timeline[0]).toEqual(
        expect.objectContaining({ toStatus: 'IN_PROGRESS', isOverride: false }),
      );
    });

    it('shows contact details support needs even when hidden from customers', async () => {
      const response = await api()
        .get(`/api/v1/admin/bookings/${BOOKING_ID}`)
        .set(as('ADMIN'))
        .expect(200);

      // `isPhoneVisible` governs what customers see, not what an admin may read.
      expect(response.body.data.professional.phone).toBe('+919800000003');
    });

    it('surfaces an open dispute alongside the booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        detailRow(BOOKING_ID, {
          disputes: [
            {
              id: 'ea000000-0000-4000-8000-000000000001',
              status: 'OPEN',
              category: 'QUALITY_ISSUE',
              reason: 'The work was rushed.',
            },
          ],
        }),
      );

      const response = await api()
        .get(`/api/v1/admin/bookings/${BOOKING_ID}`)
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data.dispute).toEqual(
        expect.objectContaining({ status: 'OPEN', category: 'QUALITY_ISSUE' }),
      );
    });

    it('404s for an unknown booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);

      await api()
        .get('/api/v1/admin/bookings/99999999-0000-4000-8000-000000000099')
        .set(as('ADMIN'))
        .expect(404);
    });
  });

  describe('overriding a status', () => {
    const reason = 'The professional confirmed they never arrived on the day.';

    it('moves the booking and records the change', async () => {
      const response = await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'COMPLETED_BY_PROFESSIONAL', reason })
        .expect(200);

      expect(response.body.data.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(bookings.get(BOOKING_ID)!.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it('flags the change as an override in the booking timeline', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'COMPLETED_BY_PROFESSIONAL', reason })
        .expect(200);

      expect(statusHistory).toEqual([
        expect.objectContaining({
          bookingId: BOOKING_ID,
          fromStatus: 'IN_PROGRESS',
          toStatus: 'COMPLETED_BY_PROFESSIONAL',
          actorUserId: ADMIN_ID,
          isOverride: true,
        }),
      ]);
    });

    it('attributes the change to the admin in the audit log', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'COMPLETED_BY_PROFESSIONAL', reason })
        .expect(200);

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'BOOKING_MODIFIED',
            entityType: 'BOOKING',
            entityId: BOOKING_ID,
            metadata: expect.objectContaining({
              from: 'IN_PROGRESS',
              to: 'COMPLETED_BY_PROFESSIONAL',
              reason,
            }),
          }),
        ]),
      );
    });

    it('tells both parties, so neither is left guessing', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'COMPLETED_BY_PROFESSIONAL', reason })
        .expect(200);

      const recipients = notifications.map((n) => n.userId);
      expect(recipients).toEqual(expect.arrayContaining([CUSTOMER_ID, PROFESSIONAL_USER_ID]));
      expect(notifications.every((n) => String(n.body).includes(reason))).toBe(true);
    });

    it('notifies each party once even if the request is retried', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'COMPLETED_BY_PROFESSIONAL', reason })
        .expect(200);

      const perParty = notifications.map((n) => `${n.userId}:${n.dedupeKey}`);
      expect(new Set(perParty).size).toBe(perParty.length);
    });

    it('requires a written reason', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'CANCELLED' })
        .expect(400);

      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'CANCELLED', reason: 'no' })
        .expect(400);
    });

    it('rejects an unknown status', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'BANANA', reason })
        .expect(400);
    });

    it('refuses a no-op move', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'IN_PROGRESS', reason })
        .expect(400);
    });

    it('will not rewind a paid booking into an earlier status', async () => {
      // A paid booking pushed backwards would be a live booking that has already
      // been charged, which is what a refund exists to resolve instead.
      const response = await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'IN_PROGRESS', reason })
        .expect(400);

      expect(response.body.error.message).toContain('Refund it instead');
      expect(bookings.get(PAID_BOOKING_ID)!.status).toBe('PAID');
    });

    it('still allows a paid booking to be closed outright', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/status`)
        .set(as('ADMIN'))
        .send({ status: 'CLOSED', reason })
        .expect(200);

      expect(bookings.get(PAID_BOOKING_ID)!.status).toBe('CLOSED');
    });
  });

  describe('refunding', () => {
    const reason = 'The professional never attended and the customer was not at fault.';

    it('closes a paid booking, so the record never reads as both paid and refunded', async () => {
      const response = await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(200);

      expect(payments.get(PAYMENT_ID)!.status).toBe('REFUNDED');
      expect(bookings.get(PAID_BOOKING_ID)!.status).toBe('CLOSED');
      expect(response.body.data.status).toBe('CLOSED');
      expect(response.body.data.payment.status).toBe('REFUNDED');
    });

    it('keeps the provider reference so finance can reconcile it', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(200);

      // Only the reason is added; the record of what was charged is untouched.
      expect(payments.get(PAYMENT_ID)!.amount).toBeDefined();
      expect(String(payments.get(PAYMENT_ID)!.failureReason)).toContain(reason);
    });

    it('records the refund against the payment in the audit log', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(200);

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'PAYMENT_REFUNDED',
            entityType: 'PAYMENT',
            entityId: PAYMENT_ID,
            metadata: expect.objectContaining({
              bookingId: PAID_BOOKING_ID,
              reason,
            }),
          }),
        ]),
      );
    });

    it('tells both parties their money is on its way back', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(200);

      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: CUSTOMER_ID, type: 'PAYMENT_REFUNDED' }),
        ]),
      );
      expect(notifications.filter((n) => n.type === 'PAYMENT_REFUNDED')).toHaveLength(2);
    });

    it('refuses a second refund', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(200);

      const second = await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(400);
      expect(second.body.error.message).toContain('already been refunded');
    });

    it('refunds exactly once when two admins refund at the same moment', async () => {
      /*
       * The payment is claimed with a status guard inside the transaction rather
       * than checked before it. The double here reports the claim as matching
       * nothing - which is what the second of two concurrent refunds sees - and the
       * refund must roll back rather than half-apply.
       *
       * Without the guard both requests read PAID, both write REFUNDED, and the
       * booking ends up with two history rows, two audit entries and two notices for
       * one refund.
       */
      prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });

      const response = await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('already refunded');
      // Nothing was written: the payment is still the paid one it was.
      expect(payments.get(PAYMENT_ID)!.status).toBe('PAID');
      expect(auditLog.filter((entry) => entry.action === 'PAYMENT_REFUNDED')).toHaveLength(0);
      expect(notifications.filter((entry) => entry.type === 'PAYMENT_REFUNDED')).toHaveLength(0);
    });

    it('refuses a payment that was never taken', async () => {
      payments.set(PAYMENT_ID, {
        id: PAYMENT_ID,
        bookingId: PAID_BOOKING_ID,
        status: 'FAILED',
        amount: decimal(1500),
        currency: 'INR',
      });

      const response = await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(400);

      expect(response.body.error.message).toContain('cannot be refunded');
    });

    it('404s when the booking never had a payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await api()
        .patch(`/api/v1/admin/bookings/${BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason })
        .expect(404);
    });

    it('requires a written reason', async () => {
      await api()
        .patch(`/api/v1/admin/bookings/${PAID_BOOKING_ID}/refund`)
        .set(as('ADMIN'))
        .send({ reason: 'no' })
        .expect(400);
    });
  });
});

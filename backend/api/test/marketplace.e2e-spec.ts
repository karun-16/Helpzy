import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';

const CUSTOMER_ID = 'a1000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = 'a1000000-0000-4000-8000-000000000002';
const PROFESSIONAL_USER_ID = 'a2000000-0000-4000-8000-000000000001';
const PROFESSIONAL_PROFILE_ID = 'a3000000-0000-4000-8000-000000000001';
const OTHER_PROFESSIONAL_USER_ID = 'a2000000-0000-4000-8000-000000000002';
const OTHER_PROFESSIONAL_PROFILE_ID = 'a3000000-0000-4000-8000-000000000002';
const ADMIN_ID = 'a4000000-0000-4000-8000-000000000001';
const BOOKING_ID = 'a5000000-0000-4000-8000-000000000001';
const SECOND_BOOKING_ID = 'a5000000-0000-4000-8000-000000000002';
const SERVICE_ID = 'a6000000-0000-4000-8000-000000000001';
const CATEGORY_ID = 'a7000000-0000-4000-8000-000000000001';
const OTHER_SERVICE_ID = 'a6000000-0000-4000-8000-000000000002';
const MESSAGE_ID = 'a8000000-0000-4000-8000-000000000001';

type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/**
 * Covers the marketplace surfaces added after the booking lifecycle: the
 * customer account and address book, notifications, My Jobs, payments, reviews,
 * booking chat, location sharing, professional profile and services, and the
 * admin console.
 *
 * The emphasis throughout is on the two things that must never be wrong:
 * a user can never reach another user's data, and a value that has not actually
 * happened is never reported as having happened.
 */
describe('Marketplace (e2e)', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>();

  const bookings = new Map<string, Record<string, unknown>>();
  const addresses = new Map<string, Record<string, unknown>>();
  const notifications: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const services = new Map<string, Record<string, unknown>>();
  const profiles = new Map<string, Record<string, unknown>>();
  const auditLog: Array<Record<string, unknown>> = [];
  const reviews = new Map<string, Record<string, unknown>>();

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    address: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    booking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    bookingStatusHistory: { create: jest.fn(), findMany: jest.fn() },
    bookingMessage: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    payment: { findFirst: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() },
    paymentAttempt: { create: jest.fn() },
    review: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    professionalProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    service: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
    serviceCategory: { findUnique: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    mediaAsset: { upsert: jest.fn() },
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

  // Logged in once at the top level so every describe block - and any single
  // test run in isolation - has a real session to work with.
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

  const loginAs = async (
    user: { id: string; phone: string; fullName: string; role: Role },
    options: { rememberAs?: string } = {},
  ) => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      email: `${user.id}@helpzy.test`,
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

    // An admin session is not usable until MFA has been completed, so the test
    // goes through the real challenge rather than forging a verified token.
    // In a non-production environment the issued code is the fixed `000000`.
    if (user.role === 'ADMIN') {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })
        .expect(200);
      token = challenge.body.data.token as string;
    }

    // Only the canonical session per role is remembered; a throwaway login (an
    // unrelated customer, say) must not overwrite the one under test.
    const remembered = options.rememberAs ?? user.role;
    tokens.set(remembered, token);
    return token;
  };

  const customerToken = () => tokens.get('CUSTOMER')!;
  const professionalToken = () => tokens.get('PROFESSIONAL')!;
  const adminToken = () => tokens.get('ADMIN')!;

  beforeEach(async () => {
    bookings.clear();
    addresses.clear();
    services.clear();
    profiles.clear();
    reviews.clear();
    notifications.length = 0;
    messages.length = 0;
    auditLog.length = 0;
    jest.clearAllMocks();

    prisma.professionalProfile.findUnique.mockImplementation(({ where }) => {
      if (where.userId === PROFESSIONAL_USER_ID) {
        return {
          id: PROFESSIONAL_PROFILE_ID,
          isLocationSharingEnabled: true,
          lastKnownLatitude: null,
          lastKnownLongitude: null,
          locationUpdatedAt: null,
        };
      }
      if (where.userId === OTHER_PROFESSIONAL_USER_ID) {
        return {
          id: OTHER_PROFESSIONAL_PROFILE_ID,
          isLocationSharingEnabled: false,
          lastKnownLatitude: null,
          lastKnownLongitude: null,
          locationUpdatedAt: null,
        };
      }
      return null;
    });

    prisma.user.findFirst.mockImplementation(({ where }) => {
      if (!where) return null;
      if (where.id === CUSTOMER_ID && where.role === 'CUSTOMER') {
        return {
          id: CUSTOMER_ID,
          fullName: 'Rahul Verma',
          phone: '+919800000002',
          email: 'rahul@helpzy.test',
          avatarUrl: null,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          _count: { bookingsAsCustomer: 3, addresses: addresses.size },
        };
      }
      if (where.id === PROFESSIONAL_USER_ID && where.role === 'PROFESSIONAL') {
        return {
          id: PROFESSIONAL_USER_ID,
          fullName: 'Meera Iyer',
          phone: '+919800000003',
          email: 'meera@helpzy.test',
          avatarUrl: null,
          role: 'PROFESSIONAL',
          status: 'ACTIVE',
          professionalProfile: {
            id: PROFESSIONAL_PROFILE_ID,
            businessName: 'Meera Home Care',
            bio: 'Appliance servicing.',
            serviceArea: 'Bengaluru',
            contactEmail: 'meera@helpzy.test',
            isPhoneVisible: false,
            yearsOfExperience: 6,
            workingHours: [{ day: 1, start: '09:00', end: '18:00' }],
            verification: 'VERIFIED',
            verifiedAt: new Date('2026-02-01T00:00:00.000Z'),
            rejectionNote: null,
            isLocationSharingEnabled: true,
          },
        };
      }
      return null;
    });

    prisma.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
    prisma.booking.count.mockResolvedValue(0);
  });

  describe('customer account and address book', () => {
    it('returns the signed-in customer’s own profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: CUSTOMER_ID,
          fullName: 'Rahul Verma',
          phone: '+919800000002',
        }),
      );
    });

    it('refuses the customer account to other roles', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
    });

    it('rejects any attempt to name a different user or change the phone', async () => {
      // `.strict()` means a client cannot smuggle in fields it does not own.
      await request(app.getHttpServer())
        .patch('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ userId: OTHER_CUSTOMER_ID, phone: '+919999999999' })
        .expect(400);

      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('updates only the session user and never their phone', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .patch('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ fullName: 'Renamed Customer' })
        .expect(200);

      // The only user the update may touch is the session user's own row.
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID, role: 'CUSTOMER' },
          data: expect.objectContaining({ fullName: 'Renamed Customer' }),
        }),
      );
      // `phone` is the login identity and is not a writable profile field.
      expect(prisma.user.updateMany.mock.calls[0][0].data).not.toHaveProperty('phone');
    });

    it('rejects a profile update that tries to change the role', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/customer/account/profile')
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ role: 'ADMIN' })
        .expect(400);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('clears the previous default when a new default address is set', async () => {
      prisma.address.count.mockResolvedValue(2);
      prisma.address.updateMany.mockResolvedValue({ count: 1 });
      prisma.address.create.mockImplementation(({ data }) => ({
        id: 'address-new',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const response = await request(app.getHttpServer())
        .post('/api/v1/customer/account/addresses')
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({
          label: 'Office',
          type: 'WORK',
          line1: '21 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          isDefault: true,
        })
        .expect(201);

      expect(response.body.data.isDefault).toBe(true);
      // The uniqueness of "exactly one default" is enforced by clearing first.
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { userId: CUSTOMER_ID, isDefault: true },
        data: { isDefault: false },
      });
    });

    it('refuses to touch an address that belongs to another customer', async () => {
      prisma.address.count.mockResolvedValue(0);

      await request(app.getHttpServer())
        .patch('/api/v1/customer/account/addresses/someone-elses-address/default')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(404);
      expect(prisma.address.update).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('lists only the session user’s notifications with an unread count', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notification-1',
          type: 'BOOKING_ACCEPTED',
          title: 'Booking accepted',
          body: 'Meera Iyer accepted your booking HZ-1.',
          bookingId: BOOKING_ID,
          readAt: null,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ]);
      prisma.notification.count.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      // The recipient is always the session user; no user id is ever accepted.
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: CUSTOMER_ID } }),
      );
      expect(response.body.data.unreadCount).toBe(1);
      expect(response.body.data.items).toHaveLength(1);
    });

    it('marks a notification read only when the session user owns it', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .patch('/api/v1/notifications/notification-1/read')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notification-1', userId: CUSTOMER_ID, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    });
  });

  describe('professional My Jobs', () => {
    beforeEach(() => {
      prisma.booking.findMany.mockImplementation(() => [
        makeBooking(BOOKING_ID, 'REQUESTED'),
        makeBooking(SECOND_BOOKING_ID, 'ON_THE_WAY'),
      ]);
    });

    it('groups every assigned booking into upcoming, active and completed', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/bookings/my-jobs')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(response.body.data.upcoming.map((b: { id: string }) => b.id)).toEqual([BOOKING_ID]);
      expect(response.body.data.active.map((b: { id: string }) => b.id)).toEqual([
        SECOND_BOOKING_ID,
      ]);
      expect(response.body.data.completed).toEqual([]);
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { professionalId: PROFESSIONAL_PROFILE_ID } }),
      );
    });

    it('does not offer a cancelled job as actionable work', async () => {
      prisma.booking.findMany.mockResolvedValue([makeBooking(BOOKING_ID, 'CANCELLED')]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/bookings/my-jobs')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(response.body.data.upcoming).toEqual([]);
      expect(response.body.data.active).toEqual([]);
      expect(response.body.data.completed).toEqual([]);
    });

    it('keeps a paid job visible as completed work', async () => {
      prisma.booking.findMany.mockResolvedValue([makeBooking(BOOKING_ID, 'CLOSED')]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/bookings/my-jobs')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(response.body.data.completed).toHaveLength(1);
    });

    it('denies customers and admins', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/professional/bookings/my-jobs')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/professional/bookings/my-jobs')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
    });
  });

  describe('payments', () => {
    it('reports online payment as unavailable when no provider is configured', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/payments/capabilities')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      // The API does not pretend a gateway exists.
      expect(response.body.data).toEqual({
        onlineAvailable: false,
        directAvailable: true,
        providerName: null,
      });
    });

    it('refuses an online payment rather than silently downgrading it', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/customer/payments/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ method: 'ONLINE' })
        .expect(400);

      expect(prisma.payment.upsert).not.toHaveBeenCalled();
    });

    it('refuses a request that tries to set its own amount', async () => {
      // `.strict()` closes the "let the client name the price" hole outright.
      await request(app.getHttpServer())
        .post(`/api/v1/customer/payments/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ method: 'DIRECT', amount: 1 })
        .expect(400);

      expect(prisma.payment.upsert).not.toHaveBeenCalled();
    });

    it('takes the amount from the agreed service price', async () => {
      const agreedBooking = {
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'CUSTOMER_CONFIRMED',
        service: { basePrice: { toNumber: () => 1499 }, currency: 'INR' },
        payment: null,
        // The lifecycle re-reads the booking to address its notification.
        customerId: CUSTOMER_ID,
        professional: { userId: PROFESSIONAL_USER_ID, user: { fullName: 'Meera Iyer' } },
        customer: { fullName: 'Rahul Verma' },
      };
      prisma.booking.findFirst.mockResolvedValue(agreedBooking);
      prisma.payment.upsert.mockResolvedValue({ id: 'payment-1' });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        bookingId: BOOKING_ID,
        amount: { toNumber: () => 1499 },
        currency: 'INR',
        method: 'DIRECT',
        status: 'PENDING',
        provider: null,
        failureReason: null,
        paidAt: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        booking: { reference: 'HZ-ABC123' },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/customer/payments/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ method: 'DIRECT' })
        .expect(201);

      // The stored amount is the service price, not anything the client sent.
      const created = prisma.payment.upsert.mock.calls[0][0].create;
      expect(created.amount.toNumber()).toBe(1499);
      expect(created.currency).toBe('INR');
    });

    it('refuses a payment for a booking that is not yet confirmed', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'SCHEDULED',
        service: { basePrice: { toNumber: () => 1499 }, currency: 'INR' },
        payment: null,
        customerId: CUSTOMER_ID,
        professional: { userId: PROFESSIONAL_USER_ID, user: { fullName: 'Meera Iyer' } },
        customer: { fullName: 'Rahul Verma' },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/customer/payments/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ method: 'DIRECT' })
        .expect(400);

      expect(prisma.payment.upsert).not.toHaveBeenCalled();
    });

    it('does not let a customer mark their own payment as paid', async () => {
      // The customer has no route that can settle a payment at all.
      await request(app.getHttpServer())
        .post(`/api/v1/customer/payments/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(404);
    });

    it('records a direct payment only when the professional confirms receipt', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'PAYMENT_PENDING',
        customerId: CUSTOMER_ID,
        customer: { fullName: 'Rahul Verma' },
        payment: { id: 'payment-1', method: 'DIRECT', status: 'PENDING' },
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.bookingStatusHistory.create.mockResolvedValue({});
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        bookingId: BOOKING_ID,
        amount: { toNumber: () => 1499 },
        currency: 'INR',
        method: 'DIRECT',
        status: 'PAID',
        provider: null,
        failureReason: null,
        paidAt: new Date(),
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        booking: { reference: 'HZ-ABC123' },
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/professional/payments/${BOOKING_ID}/direct`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ received: true })
        .expect(201);

      expect(response.body.data.status).toBe('PAID');
      // The status history records who actually confirmed the money arrived.
      expect(prisma.bookingStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          toStatus: 'PAID',
          actorUserId: PROFESSIONAL_USER_ID,
        }),
      });
    });

    it('refuses to record a direct payment for an online one', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'PAYMENT_PENDING',
        customerId: CUSTOMER_ID,
        customer: { fullName: 'Rahul Verma' },
        payment: { id: 'payment-1', method: 'ONLINE', status: 'PENDING' },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/professional/payments/${BOOKING_ID}/direct`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ received: true })
        .expect(400);

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reviews', () => {
    it('accepts a review only after the work is done', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'CUSTOMER_CONFIRMED',
        serviceId: SERVICE_ID,
        service: { title: 'AC servicing' },
        customer: { fullName: 'Rahul Verma' },
        professional: { userId: PROFESSIONAL_USER_ID },
        review: null,
      });
      prisma.review.create.mockResolvedValue({
        id: 'review-1',
        bookingId: BOOKING_ID,
        rating: 5,
        comment: 'Excellent work.',
        status: 'PENDING',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customer/reviews/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ rating: 5, comment: 'Excellent work.' })
        .expect(201);

      // A new review is not published until it is moderated.
      expect(response.body.data.status).toBe('PENDING');
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rating: 5, status: 'PENDING' }),
        }),
      );
    });

    it('refuses a review while the job is still running', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'IN_PROGRESS',
        serviceId: SERVICE_ID,
        service: { title: 'AC servicing' },
        customer: { fullName: 'Rahul Verma' },
        professional: { userId: PROFESSIONAL_USER_ID },
        review: null,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/customer/reviews/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ rating: 1 })
        .expect(409);

      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('refuses a second review of the same booking', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: BOOKING_ID,
        reference: 'HZ-ABC123',
        status: 'CLOSED',
        serviceId: SERVICE_ID,
        service: { title: 'AC servicing' },
        customer: { fullName: 'Rahul Verma' },
        professional: { userId: PROFESSIONAL_USER_ID },
        review: { id: 'review-1' },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/customer/reviews/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ rating: 5 })
        .expect(409);
    });

    it('rejects an out-of-range rating', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/customer/reviews/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ rating: 9 })
        .expect(400);
    });

    it('shows a professional only published reviews, with a first name only', async () => {
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'review-1',
          bookingId: BOOKING_ID,
          rating: 4,
          comment: 'Good.',
          status: 'PUBLISHED',
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          customer: { fullName: 'Rahul Verma' },
          booking: { reference: 'HZ-ABC123', service: { title: 'AC servicing' } },
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/reviews')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
      );
      // A review is not permission to publish a customer's full name.
      expect(response.body.data.reviews[0].customerName).toBe('Rahul');
    });

    it('recomputes the average from published reviews when moderating', async () => {
      prisma.review.findUnique.mockResolvedValue({
        id: 'review-1',
        bookingId: BOOKING_ID,
        serviceId: SERVICE_ID,
        customerId: CUSTOMER_ID,
        status: 'PENDING',
        booking: {
          reference: 'HZ-ABC123',
          service: { title: 'AC servicing' },
          professional: { id: PROFESSIONAL_PROFILE_ID },
        },
        customer: { fullName: 'Rahul Verma' },
      });
      prisma.review.updateMany.mockResolvedValue({ count: 1 });
      prisma.review.findUniqueOrThrow.mockResolvedValue({
        id: 'review-1',
        bookingId: BOOKING_ID,
        rating: 4,
        comment: 'Good.',
        status: 'PUBLISHED',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
      });
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4 }, _count: { rating: 1 } });

      await request(app.getHttpServer())
        .post('/api/v1/admin/reviews/review-1/publish')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(201);

      // The stored average is derived from the published set, not incremented.
      expect(prisma.professionalProfile.updateMany).toHaveBeenCalledWith({
        where: { id: PROFESSIONAL_PROFILE_ID },
        data: { averageRating: 4, ratingCount: 1 },
      });
    });

    it('does not let a professional moderate a review', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/reviews/review-1/publish')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(403);
    });

    it('shows an admin pending and rejected reviews too, not just published ones', async () => {
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'review-pending',
          bookingId: BOOKING_ID,
          rating: 4,
          comment: 'Arrived late.',
          status: 'PENDING',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          customer: { fullName: 'Rahul Verma' },
          booking: { reference: 'HZ-ABC123', service: { title: 'AC servicing' } },
        },
        {
          id: 'review-rejected',
          bookingId: BOOKING_ID,
          rating: 1,
          comment: null,
          status: 'REJECTED',
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          customer: { fullName: 'Rahul Verma' },
          booking: { reference: 'HZ-ABC123', service: { title: 'AC servicing' } },
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/reviews')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(response.body.data.reviews).toHaveLength(2);
      expect(response.body.data.reviews.map((review: { status: string }) => review.status)).toEqual(
        ['PENDING', 'REJECTED'],
      );
      // The moderation queue is not filtered by status, so an admin can act on
      // anything they previously left in a non-published state.
      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      );
    });

    it('shows a professional only the published reviews', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/professional/reviews')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
      );
    });
  });

  describe('booking chat', () => {
    const primeBooking = (status: string) => {
      prisma.booking.findUnique.mockResolvedValue({
        reference: 'HZ-ABC123',
        status,
        customerId: CUSTOMER_ID,
        professional: { userId: PROFESSIONAL_USER_ID },
      });
    };

    it('returns the thread with isOwn resolved against the session', async () => {
      primeBooking('ACCEPTED');
      prisma.bookingMessage.findMany.mockResolvedValue([
        {
          id: MESSAGE_ID,
          bookingId: BOOKING_ID,
          senderUserId: CUSTOMER_ID,
          body: 'Please come after 6pm.',
          readAt: null,
          createdAt: new Date('2026-03-03T00:00:00.000Z'),
          sender: { fullName: 'Rahul Verma' },
        },
        {
          id: 'message-2',
          bookingId: BOOKING_ID,
          senderUserId: PROFESSIONAL_USER_ID,
          body: 'Noted.',
          readAt: null,
          createdAt: new Date('2026-03-03T00:01:00.000Z'),
          sender: { fullName: 'Meera Iyer' },
        },
      ]);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/bookings/${BOOKING_ID}/messages`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data.map((m: { isOwn: boolean }) => m.isOwn)).toEqual([true, false]);
    });

    it('hides the thread from an unrelated customer as a 404', async () => {
      primeBooking('ACCEPTED');

      // A different customer is a valid role but not a participant, so the
      // endpoint must not even confirm the conversation exists.
      const stranger = await loginAs(
        {
          id: OTHER_CUSTOMER_ID,
          phone: '+919800000009',
          fullName: 'Someone Else',
          role: 'CUSTOMER',
        },
        { rememberAs: 'STRANGER' },
      );

      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${BOOKING_ID}/messages`)
        .set('Authorization', `Bearer ${stranger}`)
        .expect(404);

      expect(prisma.bookingMessage.findMany).not.toHaveBeenCalled();
    });

    it('refuses roles that are never participants at all', async () => {
      primeBooking('ACCEPTED');

      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${BOOKING_ID}/messages`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
    });

    it('freezes the thread once the booking is closed', async () => {
      primeBooking('CLOSED');

      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${BOOKING_ID}/messages`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ body: 'Any update?' })
        .expect(403);

      expect(prisma.bookingMessage.create).not.toHaveBeenCalled();
    });

    it('rejects an empty message', async () => {
      primeBooking('ACCEPTED');

      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${BOOKING_ID}/messages`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .send({ body: '   ' })
        .expect(400);
    });
  });

  describe('location sharing', () => {
    it('refuses to store a position while sharing is off', async () => {
      // The other professional has sharing disabled.
      prisma.professionalProfile.findUnique.mockResolvedValueOnce({
        id: OTHER_PROFESSIONAL_PROFILE_ID,
        isLocationSharingEnabled: false,
      });

      await request(app.getHttpServer())
        .post('/api/v1/professional/location')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ latitude: 12.9716, longitude: 77.5946 })
        .expect(403);

      expect(prisma.professionalProfile.update).not.toHaveBeenCalled();
    });

    it('stores a reported position and the time it was reported', async () => {
      prisma.professionalProfile.update.mockResolvedValue({
        locationUpdatedAt: new Date('2026-03-04T10:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/professional/location')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ latitude: 12.9716, longitude: 77.5946 })
        .expect(201);

      expect(response.body.data.updatedAt).toBe('2026-03-04T10:00:00.000Z');
      expect(prisma.professionalProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PROFESSIONAL_PROFILE_ID },
          data: expect.objectContaining({ lastKnownLatitude: 12.9716 }),
        }),
      );
    });

    it('rejects coordinates outside the world', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/professional/location')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ latitude: 999, longitude: 77 })
        .expect(400);
    });

    it('reports sharing-disabled rather than a made-up position', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        status: 'ON_THE_WAY',
        reference: 'HZ-ABC123',
        professional: {
          id: PROFESSIONAL_PROFILE_ID,
          businessName: 'Meera Home Care',
          isLocationSharingEnabled: false,
          lastKnownLatitude: null,
          lastKnownLongitude: null,
          locationUpdatedAt: null,
          user: { fullName: 'Meera Iyer' },
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/location`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ available: false, reason: 'SHARING_DISABLED', latitude: null }),
      );
    });

    it('distinguishes "not reported yet" from "stale"', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        status: 'ON_THE_WAY',
        reference: 'HZ-ABC123',
        professional: {
          id: PROFESSIONAL_PROFILE_ID,
          businessName: 'Meera Home Care',
          isLocationSharingEnabled: true,
          lastKnownLatitude: null,
          lastKnownLongitude: null,
          locationUpdatedAt: null,
          user: { fullName: 'Meera Iyer' },
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/location`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data.reason).toBe('NO_REPORTED_POSITION');
    });

    it('withholds the position once the booking is no longer active', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        status: 'CLOSED',
        reference: 'HZ-ABC123',
        professional: {
          id: PROFESSIONAL_PROFILE_ID,
          businessName: 'Meera Home Care',
          isLocationSharingEnabled: true,
          lastKnownLatitude: { toNumber: () => 12.9716 },
          lastKnownLongitude: { toNumber: () => 77.5946 },
          locationUpdatedAt: new Date(),
          user: { fullName: 'Meera Iyer' },
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/location`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data.reason).toBe('BOOKING_NOT_ACTIVE');
      expect(response.body.data.latitude).toBeNull();
    });
  });

  describe('booking timeline', () => {
    const history = [
      {
        id: 'history-1',
        fromStatus: null,
        toStatus: 'REQUESTED',
        actorUserId: CUSTOMER_ID,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        actor: { fullName: 'Rahul Verma' },
      },
      {
        id: 'history-2',
        fromStatus: 'REQUESTED',
        toStatus: 'ACCEPTED',
        actorUserId: PROFESSIONAL_USER_ID,
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
        actor: { fullName: 'Meera Iyer' },
      },
    ];

    it('returns only recorded history rows, oldest first', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: BOOKING_ID });
      prisma.bookingStatusHistory.findMany.mockResolvedValue(history);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((entry: { toStatus: string }) => entry.toStatus)).toEqual([
        'REQUESTED',
        'ACCEPTED',
      ]);
      // The customer's own action is flagged so the UI can label it, and the
      // professional's is not.
      expect(response.body.data[0].isOwnAction).toBe(true);
      expect(response.body.data[1].isOwnAction).toBe(false);
      expect(response.body.data[1].actorName).toBe('Meera Iyer');
      expect(prisma.bookingStatusHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bookingId: BOOKING_ID },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('shows an empty timeline rather than inventing a starting point', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: BOOKING_ID });
      prisma.bookingStatusHistory.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('will not show the timeline of a booking that is not the customer’s own', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(404);

      expect(prisma.bookingStatusHistory.findMany).not.toHaveBeenCalled();
    });

    it('gives the assigned professional the same recorded history', async () => {
      prisma.professionalProfile.findUnique.mockResolvedValue({ id: PROFESSIONAL_PROFILE_ID });
      prisma.booking.findFirst.mockResolvedValue({ id: BOOKING_ID });
      prisma.bookingStatusHistory.findMany.mockResolvedValue(history);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/professional/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      // The same rows, but "own action" is now from the professional's side.
      expect(response.body.data[0].isOwnAction).toBe(false);
      expect(response.body.data[1].isOwnAction).toBe(true);
    });

    it('will not show a professional a booking assigned to somebody else', async () => {
      prisma.professionalProfile.findUnique.mockResolvedValue({ id: PROFESSIONAL_PROFILE_ID });
      prisma.booking.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/api/v1/professional/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(404);

      expect(prisma.bookingStatusHistory.findMany).not.toHaveBeenCalled();
    });

    it('denies a customer the professional timeline', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/professional/bookings/${BOOKING_ID}/timeline`)
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(403);
    });
  });

  describe('professional profile and services', () => {
    it('never lets a professional set their own verification', async () => {
      prisma.professionalProfile.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .patch('/api/v1/professional/profile')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ verification: 'VERIFIED', businessName: 'Renamed' })
        .expect(400);

      expect(prisma.professionalProfile.updateMany).not.toHaveBeenCalled();
    });

    it('reports a real completion count rather than a stored number', async () => {
      prisma.booking.count.mockResolvedValue(7);

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/profile')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      // Counted from closed bookings, so it cannot be inflated by the user.
      expect(prisma.booking.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { professionalId: PROFESSIONAL_PROFILE_ID, status: 'CLOSED' },
        }),
      );
      expect(response.body.data.completedCount).toBe(7);
    });

    it('reports an unrated professional with no average, not zero', async () => {
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/profile')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(response.body.data.ratingCount).toBe(0);
    });

    it('refuses to delete a service that has booking history', async () => {
      prisma.service.findFirst.mockResolvedValue({ id: SERVICE_ID, _count: { bookings: 4 } });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/professional/services/${SERVICE_ID}`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(409);

      expect(response.body.error.message).toContain('booking history');
      expect(prisma.service.delete).not.toHaveBeenCalled();
    });

    it('refuses to edit a service owned by another professional', async () => {
      prisma.service.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`/api/v1/professional/services/${OTHER_SERVICE_ID}`)
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({ title: 'Hijacked' })
        .expect(404);

      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('derives a slug server-side and records a real booking count', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValue({
        id: CATEGORY_ID,
        name: 'Home Services',
        isActive: true,
      });
      prisma.service.findUnique.mockResolvedValue(null);
      prisma.service.create.mockResolvedValue({
        id: SERVICE_ID,
        title: 'Deep AC Service',
        slug: 'deep-ac-service',
        summary: null,
        description: 'A thorough air conditioner service.',
        basePrice: { toNumber: () => 1499 },
        currency: 'INR',
        durationMinutes: 90,
        isActive: true,
        category: { id: CATEGORY_ID, slug: 'home-services', name: 'Home Services' },
        _count: { bookings: 0 },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/professional/services')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({
          categoryId: CATEGORY_ID,
          title: 'Deep AC Service',
          description: 'A thorough air conditioner service.',
          priceAmount: 1499,
          durationMinutes: 90,
        })
        .expect(201);

      // The slug is generated, never accepted from the client, and the count
      // starts at a real zero rather than a made-up number.
      expect(response.body.data.slug).toBe('deep-ac-service');
      expect(response.body.data.bookingCount).toBe(0);
      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'deep-ac-service' }) }),
      );
    });

    it('refuses a service in a category that is not active', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValue({
        id: CATEGORY_ID,
        name: 'Retired Category',
        isActive: false,
      });

      await request(app.getHttpServer())
        .post('/api/v1/professional/services')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({
          categoryId: CATEGORY_ID,
          title: 'Some Service',
          description: 'A description long enough to pass validation.',
          priceAmount: 500,
          durationMinutes: 60,
        })
        .expect(404);

      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('rejects a service priced at nothing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/professional/services')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .send({
          categoryId: CATEGORY_ID,
          title: 'Free Service',
          description: 'A description long enough to pass validation.',
          priceAmount: -1,
          durationMinutes: 60,
        })
        .expect(400);
    });

    it('offers only active categories when filing a service', async () => {
      prisma.serviceCategory.findMany.mockResolvedValue([
        { id: CATEGORY_ID, slug: 'home-services', name: 'Home Services', description: null },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/professional/services/categories')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(200);

      expect(response.body.data).toEqual([
        { id: CATEGORY_ID, slug: 'home-services', name: 'Home Services', description: null },
      ]);
      // A retired category is filtered in the query, so it can never be offered.
      expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('denies the category list to a customer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/professional/services/categories')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(403);
    });
  });

  describe('admin console', () => {
    it('denies non-admins', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/summary')
        .set('Authorization', `Bearer ${customerToken()}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/admin/summary')
        .set('Authorization', `Bearer ${professionalToken()}`)
        .expect(403);
    });

    it('reports a zero for every booking status that has nothing in it', async () => {
      prisma.user.count.mockResolvedValue(2);
      prisma.booking.groupBy.mockResolvedValue([{ status: 'REQUESTED', _count: { _all: 3 } }]);
      prisma.payment.groupBy.mockResolvedValue([]);
      prisma.review.groupBy.mockResolvedValue([]);
      prisma.professionalProfile.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/summary')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(response.body.data.bookings.byStatus.REQUESTED).toBe(3);
      // An empty status is present with 0, not omitted - otherwise the console
      // would look like the status does not exist.
      expect(response.body.data.bookings.byStatus.CLOSED).toBe(0);
      expect(response.body.data.bookings.total).toBe(3);
    });

    it('refuses to suspend the last active admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: ADMIN_ID, role: 'ADMIN', status: 'ACTIVE' });
      prisma.user.count.mockResolvedValue(1);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${ADMIN_ID}/status`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'SUSPENDED' })
        .expect(409);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('audits a professional verification decision and tells the professional', async () => {
      prisma.professionalProfile.updateMany.mockResolvedValue({ count: 1 });
      // Five published services and two bookings are unrelated facts; the
      // response must not report one in place of the other.
      prisma.service.groupBy.mockResolvedValue([
        { ownerId: PROFESSIONAL_USER_ID, _count: { _all: 5 } },
      ]);
      prisma.service.findMany.mockResolvedValue(makeServices(5));
      prisma.professionalProfile.findUniqueOrThrow.mockResolvedValue({
        id: PROFESSIONAL_PROFILE_ID,
        userId: PROFESSIONAL_USER_ID,
        businessName: 'Meera Home Care',
        bio: null,
        serviceArea: 'Bengaluru',
        verification: 'VERIFIED',
        verifiedAt: new Date('2026-04-01T00:00:00.000Z'),
        rejectionNote: null,
        yearsOfExperience: 8,
        contactEmail: 'meera@helpzy.test',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        user: {
          fullName: 'Meera Iyer',
          phone: '+919800000003',
          email: 'meera@helpzy.test',
          avatarUrl: null,
        },
        _count: { bookings: 2 },
      });
      prisma.auditLog.create.mockImplementation(({ data }) => {
        auditLog.push(data);
        return { id: 'audit-1', ...data };
      });
      prisma.notification.create.mockImplementation(({ data }) => {
        notifications.push(data);
        return { id: 'notification-1', ...data };
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification-requests/${PROFESSIONAL_PROFILE_ID}/decision`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ decision: 'APPROVED' })
        .expect(201);

      expect(auditLog).toHaveLength(1);
      expect(notifications).toHaveLength(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PROFESSIONAL_VERIFIED' }),
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: PROFESSIONAL_USER_ID }),
      });
    });

    it('refuses a rejection that gives no reason', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification-requests/${PROFESSIONAL_PROFILE_ID}/decision`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ decision: 'REJECTED' })
        .expect(400);

      expect(prisma.professionalProfile.updateMany).not.toHaveBeenCalled();
    });

    it('reports published services and bookings as two separate real numbers', async () => {
      prisma.professionalProfile.findMany.mockResolvedValue([
        {
          id: PROFESSIONAL_PROFILE_ID,
          userId: PROFESSIONAL_USER_ID,
          businessName: 'Meera Home Care',
          bio: null,
          serviceArea: 'Bengaluru',
          verification: 'PENDING',
          verifiedAt: null,
          rejectionNote: null,
          yearsOfExperience: 8,
          contactEmail: 'meera@helpzy.test',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          user: {
            fullName: 'Meera Iyer',
            phone: '+919800000003',
            email: null,
            avatarUrl: null,
          },
          _count: { bookings: 2 },
        },
      ]);
      prisma.service.groupBy.mockResolvedValue([
        { ownerId: PROFESSIONAL_USER_ID, _count: { _all: 5 } },
      ]);
      prisma.service.findMany.mockResolvedValue(makeServices(5));

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/verification-requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(response.body.data[0]).toMatchObject({
        serviceCount: 5,
        bookingCount: 2,
        // The real services and stated experience the admin reviews, rather than
        // a bare count.
        services: [
          { id: 'service-1', title: 'AC servicing', isActive: true },
          { id: 'service-2', title: 'AC servicing', isActive: true },
          { id: 'service-3', title: 'AC servicing', isActive: true },
          { id: 'service-4', title: 'AC servicing', isActive: true },
          { id: 'service-5', title: 'AC servicing', isActive: true },
        ],
        yearsOfExperience: 8,
        contactEmail: 'meera@helpzy.test',
      });
    });

    it('cannot decide the same request twice', async () => {
      // Zero rows updated means it was already decided.
      prisma.professionalProfile.updateMany.mockResolvedValue({ count: 0 });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification-requests/${PROFESSIONAL_PROFILE_ID}/decision`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ decision: 'APPROVED' })
        .expect(409);
    });
  });
});

/**
 * The services a professional owns, as the admin verification queue now reads
 * them. The count and the rows come from the same source, so a mismatch between
 * `serviceCount` and `services.length` is a real failure, not a test artefact.
 */
function makeServices(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `service-${index + 1}`,
    ownerId: PROFESSIONAL_USER_ID,
    title: 'AC servicing',
    isActive: true,
  }));
}
function makeBooking(id: string, status: string) {
  return {
    id,
    professionalId: PROFESSIONAL_PROFILE_ID,
    reference: 'HZ-ABC123',
    status,
    completedAt: null,
    scheduledStart: new Date('2026-10-05T09:30:00.000Z'),
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    customerNote: 'Please call before arriving.',
    service: { id: SERVICE_ID, title: 'AC servicing' },
    customer: { id: CUSTOMER_ID, fullName: 'Rahul Verma' },
    address: {
      label: 'Home',
      line1: '221B Baker Street',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    },
  };
}

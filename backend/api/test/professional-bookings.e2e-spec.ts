import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';

const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const PROFESSIONAL_USER_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_PROFESSIONAL_USER_ID = '20000000-0000-4000-8000-000000000002';
const PROFESSIONAL_PROFILE_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_PROFESSIONAL_PROFILE_ID = '30000000-0000-4000-8000-000000000002';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';
const SECOND_BOOKING_ID = '40000000-0000-4000-8000-000000000002';

type BookingRecord = {
  id: string;
  professionalId: string;
  reference: string;
  status: LifecycleStatus;
  completedAt: Date | null;
  scheduledStart: Date;
  createdAt: Date;
  customerNote: string;
  service: { id: string; title: string };
  customer: { id: string; fullName: string };
  address: {
    label: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
};

type LifecycleStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'ON_THE_WAY'
  | 'IN_PROGRESS'
  | 'COMPLETED_BY_PROFESSIONAL'
  | 'CUSTOMER_CONFIRMED';

describe('Professional bookings (e2e)', () => {
  let app: INestApplication;
  let customerToken: string;
  let adminToken: string;
  let professionalToken: string;
  let otherProfessionalToken: string;
  const bookings = new Map<string, BookingRecord>();
  const history: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const prisma = {
    user: { findUnique: jest.fn() },
    professionalProfile: { findUnique: jest.fn() },
    booking: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    bookingStatusHistory: { create: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    const transaction = {
      booking: prisma.booking,
      bookingStatusHistory: prisma.bookingStatusHistory,
      notification: prisma.notification,
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

    app = moduleRef.createNestApplication();
    configureApp(app, moduleRef.get<AppConfigRef>(APP_CONFIG));
    await app.init();

    const loginAs = async (user: {
      id: string;
      phone: string;
      fullName: string;
      role: 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';
    }) => {
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        email: `${user.id}@helpzy.test`,
        status: 'ACTIVE',
        passwordHash: 'hashed',
      });
      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: user.phone })
        .expect(200);
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: user.phone, otp: otpResponse.body.data.otp })
        .expect(200);
      return loginResponse.body.data.token as string;
    };

    customerToken = await loginAs({
      id: CUSTOMER_ID,
      phone: '+919800000002',
      fullName: 'Rahul Verma',
      role: 'CUSTOMER',
    });
    adminToken = await loginAs({
      id: '90000000-0000-4000-8000-000000000001',
      phone: '+919800000001',
      fullName: 'Aditi Rao',
      role: 'ADMIN',
    });
    professionalToken = await loginAs({
      id: PROFESSIONAL_USER_ID,
      phone: '+919800000003',
      fullName: 'Meera Iyer',
      role: 'PROFESSIONAL',
    });
    otherProfessionalToken = await loginAs({
      id: OTHER_PROFESSIONAL_USER_ID,
      phone: '+919800000005',
      fullName: 'Other Professional',
      role: 'PROFESSIONAL',
    });
  }, 20_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  beforeEach(() => {
    bookings.clear();
    history.length = 0;
    notifications.length = 0;
    jest.clearAllMocks();
    prisma.professionalProfile.findUnique.mockImplementation(({ where }) => {
      if (where.userId === PROFESSIONAL_USER_ID) return { id: PROFESSIONAL_PROFILE_ID };
      if (where.userId === OTHER_PROFESSIONAL_USER_ID) return { id: OTHER_PROFESSIONAL_PROFILE_ID };
      return null;
    });
    prisma.booking.findMany.mockImplementation(({ where }) =>
      [...bookings.values()].filter(
        (booking) =>
          booking.professionalId === where.professionalId && booking.status === where.status,
      ),
    );
    prisma.booking.findFirst.mockImplementation(({ where, select }) => {
      const booking = bookings.get(where.id);
      if (!booking || booking.professionalId !== where.professionalId) return null;
      if (!select) return booking;
      // The lifecycle only needs enough of the booking to write history and
      // address the notification: identity, reference and both party names.
      return {
        id: booking.id,
        status: booking.status,
        reference: booking.reference,
        customerId: booking.customer.id,
        professional: {
          userId:
            booking.professionalId === PROFESSIONAL_PROFILE_ID
              ? PROFESSIONAL_USER_ID
              : OTHER_PROFESSIONAL_USER_ID,
          user: {
            fullName: booking.customer.fullName === 'Rahul Verma' ? 'Meera Iyer' : 'Other Pro',
          },
        },
        customer: { fullName: booking.customer.fullName },
      };
    });
    prisma.booking.updateMany.mockImplementation(({ where, data }) => {
      const booking = bookings.get(where.id);
      if (
        !booking ||
        booking.professionalId !== where.professionalId ||
        booking.status !== where.status
      ) {
        return { count: 0 };
      }
      booking.status = data.status;
      if (data.completedAt !== undefined) booking.completedAt = data.completedAt;
      return { count: 1 };
    });
    prisma.bookingStatusHistory.create.mockImplementation(({ data }) => {
      history.push(data);
      return { id: `history-${history.length}`, ...data, createdAt: new Date() };
    });
    prisma.notification.create.mockImplementation(({ data }) => {
      notifications.push(data);
      return { id: `notification-${notifications.length}`, ...data };
    });
  });

  it('lists REQUESTED bookings assigned to the authenticated professional', async () => {
    bookings.set(BOOKING_ID, createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID));
    bookings.set(
      SECOND_BOOKING_ID,
      createBooking(SECOND_BOOKING_ID, OTHER_PROFESSIONAL_PROFILE_ID),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/professional/bookings')
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        id: BOOKING_ID,
        status: 'REQUESTED',
        reference: 'HZ-REQUEST-0001',
        customer: expect.objectContaining({ id: CUSTOMER_ID, fullName: 'Rahul Verma' }),
        service: expect.objectContaining({ title: 'AC servicing' }),
      }),
    );
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: PROFESSIONAL_PROFILE_ID, status: 'REQUESTED' },
      }),
    );

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/professional/bookings/${BOOKING_ID}`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(200);
    expect(detailResponse.body.data.location.line1).toBe('221B Baker Street');
  });

  it('allows the assigned professional to accept and records the transition', async () => {
    bookings.set(BOOKING_ID, createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID));

    const response = await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/accept`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .send({ professionalId: OTHER_PROFESSIONAL_PROFILE_ID })
      .expect(201);

    expect(response.body.data.status).toBe('ACCEPTED');
    expect(bookings.get(BOOKING_ID)?.status).toBe('ACCEPTED');
    expect(history).toEqual([
      {
        bookingId: BOOKING_ID,
        fromStatus: 'REQUESTED',
        toStatus: 'ACCEPTED',
        actorUserId: PROFESSIONAL_USER_ID,
      },
    ]);
  });

  it('allows the assigned professional to reject another REQUESTED booking and records it', async () => {
    bookings.set(SECOND_BOOKING_ID, createBooking(SECOND_BOOKING_ID, PROFESSIONAL_PROFILE_ID));

    const response = await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${SECOND_BOOKING_ID}/reject`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(201);

    expect(response.body.data.status).toBe('REJECTED');
    expect(history).toEqual([
      {
        bookingId: SECOND_BOOKING_ID,
        fromStatus: 'REQUESTED',
        toStatus: 'REJECTED',
        actorUserId: PROFESSIONAL_USER_ID,
      },
    ]);
  });

  it('hides another professional’s booking and prevents modifying it', async () => {
    bookings.set(BOOKING_ID, createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID));

    await request(app.getHttpServer())
      .get(`/api/v1/professional/bookings/${BOOKING_ID}`)
      .set('Authorization', `Bearer ${otherProfessionalToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/accept`)
      .set('Authorization', `Bearer ${otherProfessionalToken}`)
      .expect(404);

    expect(bookings.get(BOOKING_ID)?.status).toBe('REQUESTED');
    expect(history).toHaveLength(0);
  });

  it('denies customer access to professional booking decisions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/professional/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/professional/bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('rejects any decision after a booking has left REQUESTED', async () => {
    const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
    bookings.set(BOOKING_ID, accepted);

    await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/accept`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/professional/bookings/${BOOKING_ID}/reject`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(409);

    expect(accepted.status).toBe('ACCEPTED');
    expect(history).toHaveLength(0);
  });

  describe('post-acceptance lifecycle', () => {
    const professionalSteps = [
      { from: 'ACCEPTED', action: 'SCHEDULED', to: 'SCHEDULED' },
      { from: 'SCHEDULED', action: 'ON_THE_WAY', to: 'ON_THE_WAY' },
      { from: 'ON_THE_WAY', action: 'IN_PROGRESS', to: 'IN_PROGRESS' },
      {
        from: 'IN_PROGRESS',
        action: 'COMPLETED_BY_PROFESSIONAL',
        to: 'COMPLETED_BY_PROFESSIONAL',
      },
    ] as const;

    it.each(professionalSteps)(
      'advances $from to $to and records the status history',
      async ({ from, action, to }) => {
        const booking = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, from);
        bookings.set(BOOKING_ID, booking);

        const response = await request(app.getHttpServer())
          .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
          .set('Authorization', `Bearer ${professionalToken}`)
          .send({ action })
          .expect(201);

        expect(response.body.data.status).toBe(to);
        expect(booking.status).toBe(to);
        expect(history).toEqual([
          {
            bookingId: BOOKING_ID,
            fromStatus: from,
            toStatus: to,
            actorUserId: PROFESSIONAL_USER_ID,
          },
        ]);
      },
    );

    it('notifies the customer of a professional step, addressed to the booking’s customer', async () => {
      bookings.set(BOOKING_ID, createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ON_THE_WAY'));

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'IN_PROGRESS' })
        .expect(201);

      // The professional's own step is news for the customer, never for the
      // professional, and the recipient comes from the booking rather than input.
      expect(notifications).toEqual([
        expect.objectContaining({
          userId: CUSTOMER_ID,
          type: 'BOOKING_IN_PROGRESS',
          bookingId: BOOKING_ID,
          // Retrying the same step must not produce a second notification.
          dedupeKey: `BOOKING_IN_PROGRESS:${BOOKING_ID}:${CUSTOMER_ID}`,
        }),
      ]);
    });

    it('ignores a client-supplied professionalId and uses the session profile', async () => {
      bookings.set(BOOKING_ID, createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED'));

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'SCHEDULED', professionalId: OTHER_PROFESSIONAL_PROFILE_ID })
        .expect(201);

      expect(prisma.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BOOKING_ID, professionalId: PROFESSIONAL_PROFILE_ID, status: 'ACCEPTED' },
        }),
      );
      expect(history).toEqual([
        {
          bookingId: BOOKING_ID,
          fromStatus: 'ACCEPTED',
          toStatus: 'SCHEDULED',
          actorUserId: PROFESSIONAL_USER_ID,
        },
      ]);
    });

    it('stamps completedAt when the professional marks the booking complete', async () => {
      const booking = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'IN_PROGRESS');
      bookings.set(BOOKING_ID, booking);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'COMPLETED_BY_PROFESSIONAL' })
        .expect(201);

      expect(booking.completedAt).toBeInstanceOf(Date);
    });

    it('rejects a lifecycle step taken out of order', async () => {
      const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, accepted);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'IN_PROGRESS' })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
      expect(accepted.status).toBe('ACCEPTED');
      expect(history).toHaveLength(0);
    });

    it('rejects repeating a step that has already been applied', async () => {
      const scheduled = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'SCHEDULED');
      bookings.set(BOOKING_ID, scheduled);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'SCHEDULED' })
        .expect(409);

      expect(scheduled.status).toBe('SCHEDULED');
      expect(history).toHaveLength(0);
    });

    it('rejects an unknown lifecycle action', async () => {
      const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, accepted);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'NOT_A_STATUS' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({})
        .expect(400);

      expect(accepted.status).toBe('ACCEPTED');
      expect(history).toHaveLength(0);
    });

    it('rejects the customer-owned confirmation action on the professional endpoint', async () => {
      const completed = createBooking(
        BOOKING_ID,
        PROFESSIONAL_PROFILE_ID,
        'COMPLETED_BY_PROFESSIONAL',
      );
      bookings.set(BOOKING_ID, completed);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'CUSTOMER_CONFIRMED' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(completed.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(history).toHaveLength(0);
    });

    it('rejects a lifecycle step once the customer has confirmed', async () => {
      const confirmed = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'CUSTOMER_CONFIRMED');
      bookings.set(BOOKING_ID, confirmed);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({ action: 'COMPLETED_BY_PROFESSIONAL' })
        .expect(409);

      expect(confirmed.status).toBe('CUSTOMER_CONFIRMED');
      expect(history).toHaveLength(0);
    });

    it('never lets a customer perform a professional transition', async () => {
      const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, accepted);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ action: 'SCHEDULED' })
        .expect(403);

      expect(accepted.status).toBe('ACCEPTED');
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(history).toHaveLength(0);
    });

    it('does not let an admin bypass booking ownership through the professional endpoint', async () => {
      const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, accepted);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'SCHEDULED' })
        .expect(403);

      expect(accepted.status).toBe('ACCEPTED');
      expect(history).toHaveLength(0);
    });

    it("hides and rejects lifecycle steps on another professional's booking", async () => {
      const accepted = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, accepted);

      await request(app.getHttpServer())
        .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
        .set('Authorization', `Bearer ${otherProfessionalToken}`)
        .send({ action: 'SCHEDULED' })
        .expect(404);

      expect(accepted.status).toBe('ACCEPTED');
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(history).toHaveLength(0);
    });

    it('walks the full professional lifecycle in order', async () => {
      const booking = createBooking(BOOKING_ID, PROFESSIONAL_PROFILE_ID, 'ACCEPTED');
      bookings.set(BOOKING_ID, booking);

      for (const action of [
        'SCHEDULED',
        'ON_THE_WAY',
        'IN_PROGRESS',
        'COMPLETED_BY_PROFESSIONAL',
      ] as const) {
        const response = await request(app.getHttpServer())
          .post(`/api/v1/professional/bookings/${BOOKING_ID}/advance`)
          .set('Authorization', `Bearer ${professionalToken}`)
          .send({ action })
          .expect(201);
        expect(response.body.data.status).toBe(action);
      }

      expect(booking.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(history.map((entry) => entry.toStatus)).toEqual([
        'SCHEDULED',
        'ON_THE_WAY',
        'IN_PROGRESS',
        'COMPLETED_BY_PROFESSIONAL',
      ]);
    });
  });
});

function createBooking(
  id: string,
  professionalId: string,
  status: LifecycleStatus = 'REQUESTED',
): BookingRecord {
  return {
    id,
    professionalId,
    reference: id === BOOKING_ID ? 'HZ-REQUEST-0001' : 'HZ-REQUEST-0002',
    status,
    completedAt: null,
    scheduledStart: new Date('2026-10-05T09:30:00.000Z'),
    createdAt: new Date('2026-09-30T12:00:00.000Z'),
    customerNote: 'Please call before arriving.',
    service: { id: '50000000-0000-4000-8000-000000000001', title: 'AC servicing' },
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

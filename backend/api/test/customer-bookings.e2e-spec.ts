import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';

const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '10000000-0000-4000-8000-000000000002';
const PROFESSIONAL_USER_ID = '20000000-0000-4000-8000-000000000001';
const PROFESSIONAL_ID = '20000000-0000-4000-8000-000000000001';
const SERVICE_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';

type LifecycleStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'SCHEDULED'
  | 'ON_THE_WAY'
  | 'IN_PROGRESS'
  | 'COMPLETED_BY_PROFESSIONAL'
  | 'CUSTOMER_CONFIRMED';

type StoredBooking = {
  id: string;
  customerId: string;
  reference: string;
  status: LifecycleStatus;
  scheduledStart: Date;
  createdAt: Date;
  customerNote: string;
  service: { id: string; title: string };
  customer: { id: string; fullName: string };
  professional: {
    id: string;
    userId: string;
    user: { fullName: string };
    businessName: string;
  };
  address: {
    label: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
};

describe('Customer bookings (e2e)', () => {
  let app: INestApplication;
  let customerToken: string;
  let otherCustomerToken: string;
  let professionalToken: string;
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    customerProfile: { create: jest.fn() },
    professionalProfile: { create: jest.fn(), findUnique: jest.fn() },
    serviceCategory: { findMany: jest.fn() },
    service: { findFirst: jest.fn() },
    address: { create: jest.fn() },
    booking: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    bookingStatusHistory: { create: jest.fn(), findMany: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    const transaction = {
      address: prisma.address,
      booking: prisma.booking,
      bookingStatusHistory: prisma.bookingStatusHistory,
      notification: prisma.notification,
      user: prisma.user,
      customerProfile: prisma.customerProfile,
      professionalProfile: prisma.professionalProfile,
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
      role: 'CUSTOMER' | 'PROFESSIONAL';
    }) => {
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        email: `${user.role.toLocaleLowerCase()}@helpzy.test`,
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
    otherCustomerToken = await loginAs({
      id: OTHER_CUSTOMER_ID,
      phone: '+919800000004',
      fullName: 'Irfan Khan',
      role: 'CUSTOMER',
    });
    professionalToken = await loginAs({
      id: PROFESSIONAL_USER_ID,
      phone: '+919800000003',
      fullName: 'Meera Iyer',
      role: 'PROFESSIONAL',
    });
  }, 15_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires an authenticated customer for customer booking endpoints', async () => {
    await request(app.getHttpServer()).get('/api/v1/customer/bookings').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(403);
  });

  it('creates a REQUESTED booking using the authenticated customer and a customer-owned address', async () => {
    const scheduledStart = new Date(Date.now() + 86_400_000).toISOString();
    const pastResponse = await request(app.getHttpServer())
      .post('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        professionalId: PROFESSIONAL_ID,
        serviceId: SERVICE_ID,
        scheduledStart: new Date(Date.now() - 60_000).toISOString(),
        address: {
          label: 'Home',
          line1: '221B Baker Street',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
        },
      })
      .expect(400);
    expect(pastResponse.body.error.code).toBe('VALIDATION_FAILED');

    const storedAddress = { id: '50000000-0000-4000-8000-000000000001' };
    const storedBooking = createStoredBooking();
    prisma.user.findFirst.mockResolvedValue({ id: CUSTOMER_ID, fullName: 'Rahul Verma' });
    prisma.service.findFirst.mockResolvedValue({
      id: SERVICE_ID,
      durationMinutes: 90,
      basePrice: '899.00',
      currency: 'INR',
      owner: {
        id: PROFESSIONAL_USER_ID,
        fullName: 'Meera Iyer',
        professionalProfile: { id: storedBooking.professional.id },
      },
    });
    prisma.address.create.mockResolvedValue(storedAddress);
    prisma.booking.create.mockResolvedValue(storedBooking);

    const response = await request(app.getHttpServer())
      .post('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        customerId: '70000000-0000-4000-8000-000000000001',
        status: 'PAID',
        professionalId: PROFESSIONAL_ID,
        serviceId: SERVICE_ID,
        scheduledStart,
        requirement: 'Please call on arrival.',
        address: {
          label: 'Home',
          line1: '221B Baker Street',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
        },
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(prisma.booking.create).not.toHaveBeenCalled();

    const validResponse = await request(app.getHttpServer())
      .post('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        professionalId: PROFESSIONAL_ID,
        serviceId: SERVICE_ID,
        scheduledStart,
        requirement: 'Please call on arrival.',
        address: {
          label: 'Home',
          line1: '221B Baker Street',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
        },
      })
      .expect(201);

    expect(validResponse.body.data).toEqual(
      expect.objectContaining({
        id: BOOKING_ID,
        reference: 'HZ-ABC123DEF456',
        status: 'REQUESTED',
        service: { id: SERVICE_ID, title: 'AC servicing' },
      }),
    );
    expect(prisma.address.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: CUSTOMER_ID }) }),
    );
    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: CUSTOMER_ID, status: 'REQUESTED' }),
      }),
    );
    expect(prisma.bookingStatusHistory.create).toHaveBeenCalledWith({
      data: {
        bookingId: BOOKING_ID,
        fromStatus: null,
        toStatus: 'REQUESTED',
        actorUserId: CUSTOMER_ID,
      },
    });
  });

  it('scopes listing and detail lookups to the authenticated customer', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(listResponse.body.data).toEqual([]);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID } }),
    );

    prisma.booking.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/customer/bookings/${BOOKING_ID}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOOKING_ID, customerId: CUSTOMER_ID } }),
    );
  });

  describe('customer completion confirmation', () => {
    it('confirms a professionally completed booking and records the transition', async () => {
      const completed = createStoredBooking('COMPLETED_BY_PROFESSIONAL');
      primeBookingLookup(completed);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ customerId: OTHER_CUSTOMER_ID, professionalId: PROFESSIONAL_ID })
        .expect(201);

      expect(response.body.data.status).toBe('CUSTOMER_CONFIRMED');
      expect(prisma.bookingStatusHistory.create).toHaveBeenCalledWith({
        data: {
          bookingId: BOOKING_ID,
          fromStatus: 'COMPLETED_BY_PROFESSIONAL',
          toStatus: 'CUSTOMER_CONFIRMED',
          actorUserId: CUSTOMER_ID,
        },
      });
    });

    it('scopes the confirmation to the authenticated customer', async () => {
      const completed = createStoredBooking('COMPLETED_BY_PROFESSIONAL');
      primeBookingLookup(completed);

      await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      // The ownership filter is the session customer, never a client-supplied id.
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BOOKING_ID, customerId: CUSTOMER_ID } }),
      );
      expect(prisma.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BOOKING_ID, customerId: CUSTOMER_ID, status: 'COMPLETED_BY_PROFESSIONAL' },
        }),
      );
    });

    it('rejects confirming a booking that is not yet completed by the professional', async () => {
      const inProgress = createStoredBooking('IN_PROGRESS');
      primeBookingLookup(inProgress);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
      expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
      expect(inProgress.status).toBe('IN_PROGRESS');
    });

    it('rejects confirming a booking that was already confirmed', async () => {
      const confirmed = createStoredBooking('CUSTOMER_CONFIRMED');
      primeBookingLookup(confirmed);

      await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(409);

      expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
      expect(confirmed.status).toBe('CUSTOMER_CONFIRMED');
    });

    it("hides and rejects confirmation of another customer's booking", async () => {
      const completed = createStoredBooking('COMPLETED_BY_PROFESSIONAL');
      primeBookingLookup(completed, { onlyFor: OTHER_CUSTOMER_ID });

      await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(404);

      expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
      expect(completed.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it("does not let an unrelated customer confirm another customer's booking", async () => {
      const completed = createStoredBooking('COMPLETED_BY_PROFESSIONAL');
      primeBookingLookup(completed, { onlyFor: OTHER_CUSTOMER_ID });

      await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);

      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
      expect(completed.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it('never lets a professional perform the customer confirmation', async () => {
      const completed = createStoredBooking('COMPLETED_BY_PROFESSIONAL');
      primeBookingLookup(completed);

      await request(app.getHttpServer())
        .post(`/api/v1/customer/bookings/${BOOKING_ID}/confirm`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .expect(403);

      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(prisma.bookingStatusHistory.create).not.toHaveBeenCalled();
      expect(completed.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it('exposes the confirmed status on the booking detail', async () => {
      const confirmed = createStoredBooking('CUSTOMER_CONFIRMED');
      primeBookingLookup(confirmed);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/bookings/${BOOKING_ID}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ id: BOOKING_ID, status: 'CUSTOMER_CONFIRMED' }),
      );
    });
  });

  /**
   * Wires the mocked booking row into the lifecycle service's lookups. The
   * detail read and the guarded update both resolve through `findFirst`.
   */
  function primeBookingLookup(booking: StoredBooking, options: { onlyFor?: string } = {}): void {
    prisma.booking.findFirst.mockImplementation(
      ({ where }: { where: { id: string; customerId?: string } }) => {
        if (where.id !== booking.id) return null;
        if (where.customerId && where.customerId !== booking.customerId) return null;
        if (options.onlyFor && booking.customerId !== options.onlyFor) return null;
        return booking;
      },
    );
    prisma.booking.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; customerId: string; status: string };
        data: { status: LifecycleStatus };
      }) => {
        const matches =
          booking.id === where.id &&
          booking.customerId === where.customerId &&
          booking.status === where.status;
        if (!matches) return { count: 0 };
        booking.status = data.status;
        return { count: 1 };
      },
    );
  }
});

function createStoredBooking(status: LifecycleStatus = 'REQUESTED'): StoredBooking {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    reference: 'HZ-ABC123DEF456',
    status,
    scheduledStart: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    customerNote: 'Please call on arrival.',
    service: { id: SERVICE_ID, title: 'AC servicing' },
    customer: { id: CUSTOMER_ID, fullName: 'Rahul Verma' },
    professional: {
      id: '60000000-0000-4000-8000-000000000001',
      userId: PROFESSIONAL_USER_ID,
      user: { fullName: 'Meera Iyer' },
      businessName: 'Meera Home Care',
    },
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

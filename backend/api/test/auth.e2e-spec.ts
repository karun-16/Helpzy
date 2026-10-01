import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    customerProfile: { create: jest.Mock };
    professionalProfile: { create: jest.Mock; findMany: jest.Mock };
    serviceCategory: { findMany: jest.Mock };
    service: { findFirst: jest.Mock };
    review: { findMany: jest.Mock };
    booking: { groupBy: jest.Mock };
  };

  beforeAll(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerProfile: { create: jest.fn() },
      professionalProfile: { create: jest.fn(), findMany: jest.fn() },
      serviceCategory: { findMany: jest.fn() },
      service: { findFirst: jest.fn() },
      review: { findMany: jest.fn() },
      booking: { groupBy: jest.fn() },
    };

    const transaction = {
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
        user: prisma.user,
        customerProfile: prisma.customerProfile,
        professionalProfile: prisma.professionalProfile,
        serviceCategory: prisma.serviceCategory,
        service: prisma.service,
        review: prisma.review,
        booking: prisma.booking,
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, moduleRef.get<AppConfigRef>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('allows a customer to request and verify OTP and then access a protected route', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'customer-1',
      email: 'customer@helpzy.test',
      phone: '+919800000002',
      fullName: 'Rahul Verma',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const requestOtpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002' })
      .expect(200);

    expect(requestOtpResponse.body.success).toBe(true);
    expect(requestOtpResponse.body.data).toEqual(
      expect.objectContaining({
        phone: '+919800000002',
        status: 'OTP_SENT',
      }),
    );

    const otp = requestOtpResponse.body.data.otp;
    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '+919800000002', otp })
      .expect(200);

    expect(verifyResponse.body.success).toBe(true);
    expect(verifyResponse.body.data.token).toEqual(expect.any(String));
    expect(verifyResponse.body.data.user.role).toBe('CUSTOMER');

    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${verifyResponse.body.data.token}`)
      .expect(200);

    expect(meResponse.body.data.user.role).toBe('CUSTOMER');

    const dashboardResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/dashboard')
      .set('Authorization', `Bearer ${verifyResponse.body.data.token}`)
      .expect(200);

    expect(dashboardResponse.body.data.dashboard).toBe('customer');
  });

  it('allows a professional to verify OTP and access the professional-only route', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'professional-1',
      email: 'meera@helpzy.test',
      phone: '+919800000003',
      fullName: 'Meera Iyer',
      role: 'PROFESSIONAL',
      status: 'ACTIVE',
      passwordHash: 'hashed',
    });

    const requestOtpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000003' })
      .expect(200);

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '+919800000003', otp: requestOtpResponse.body.data.otp })
      .expect(200);

    expect(verifyResponse.body.data.user.role).toBe('PROFESSIONAL');

    const dashboardResponse = await request(app.getHttpServer())
      .get('/api/v1/professional/dashboard')
      .set('Authorization', `Bearer ${verifyResponse.body.data.token}`)
      .expect(200);

    expect(dashboardResponse.body.data.dashboard).toBe('professional');
  });

  it('serves database-backed discovery to guests and every signed-in role', async () => {
    const customer = {
      id: 'customer-1',
      email: 'customer@helpzy.test',
      phone: '+919800000002',
      fullName: 'Rahul Verma',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'hashed',
    };
    const professional = {
      id: 'professional-1',
      fullName: 'Meera Iyer',
      avatarUrl: null,
      professionalProfile: {
        businessName: 'Meera Home Care',
        bio: 'Home cleaning and appliance servicing.',
        verification: 'VERIFIED',
        serviceArea: 'Bengaluru',
        // No reviews and no completed jobs yet, so the profile must show an
        // absent rating and a zero count rather than an invented 5.0.
        averageRating: { toNumber: () => 0 },
        ratingCount: 0,
        contactEmail: 'meera@example.test',
        yearsOfExperience: 6,
        workingHours: [{ day: 1, start: '09:00', end: '18:00' }],
      },
      services: [
        {
          id: 'service-00000001',
          title: 'AC servicing',
          summary: 'Split and window AC service.',
          category: { id: 'category-000001', slug: 'home-services', name: 'Home Services' },
          // Prisma returns money as a Decimal, so the mock mirrors that rather
          // than a bare number the real query would never produce.
          basePrice: { toNumber: () => 1499 },
          currency: 'INR',
          durationMinutes: 90,
        },
      ],
    };

    const loginAs = async (user: typeof customer) => {
      prisma.user.findUnique.mockResolvedValue(user);
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

    prisma.serviceCategory.findMany.mockResolvedValue([
      {
        id: 'category-000001',
        slug: 'home-services',
        name: 'Home Services',
        description: 'Cleaning and repairs.',
        iconUrl: null,
        services: [{ id: 'service-00000001', title: 'AC servicing', summary: 'AC maintenance.' }],
      },
    ]);
    // A guest sees the marketplace, because `/` is the public discovery surface.
    const guestResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/services')
      .expect(200);
    expect(guestResponse.body.data[0].services[0].title).toBe('AC servicing');

    const customerToken = await loginAs(customer);
    const categoriesResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/services')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(categoriesResponse.body.data[0].services[0].title).toBe('AC servicing');

    prisma.user.findMany.mockResolvedValue([professional]);
    // A professional with no history: no published reviews, no closed bookings.
    prisma.review.findMany.mockResolvedValue([]);
    prisma.professionalProfile.findMany.mockResolvedValue([
      { id: 'professional-profile-1', userId: 'professional-1' },
    ]);
    prisma.booking.groupBy.mockResolvedValue([]);
    const availableResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/professionals')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(availableResponse.body.data[0].businessName).toBe('Meera Home Care');
    // Honest empty state, not a fabricated rating.
    expect(availableResponse.body.data[0]).toEqual(
      expect.objectContaining({ completedCount: 0, reviews: [] }),
    );
    expect(availableResponse.body.data[0].averageRating).toBeUndefined();
    expect(availableResponse.body.data[0].yearsOfExperience).toBe(6);

    prisma.service.findFirst.mockResolvedValue({
      id: 'service-00000001',
      title: 'AC servicing',
      summary: 'AC maintenance.',
      category: { id: 'category-000001', slug: 'home-services', name: 'Home Services' },
      owner: professional,
    });
    const professionalsResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/services/service-00000001/professionals')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(professionalsResponse.body.data.professionals[0].verification).toBe('VERIFIED');

    prisma.user.findFirst.mockResolvedValue(professional);
    const profileResponse = await request(app.getHttpServer())
      .get('/api/v1/customer/professionals/professional-1')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(profileResponse.body.data.services[0].title).toBe('AC servicing');

    // A professional reaches the same marketplace from the header, so the
    // catalogue is not customer-only.
    const professionalToken = await loginAs({
      ...customer,
      id: 'professional-1',
      phone: '+919800000003',
      role: 'PROFESSIONAL',
    });
    await request(app.getHttpServer())
      .get('/api/v1/customer/services')
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(200);

    // A private customer route is still scoped to customers: widening discovery
    // must not widen anything owned.
    await request(app.getHttpServer())
      .get('/api/v1/customer/account/profile')
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/customer/bookings')
      .set('Authorization', `Bearer ${professionalToken}`)
      .expect(403);
  });

  it('rejects a client-supplied ADMIN role on the public OTP route', async () => {
    prisma.user.create.mockClear();

    await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002', role: 'ADMIN' })
      .expect(400);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('registers a new customer atomically and rejects reuse of the registration OTP', async () => {
    const phone = '+919876543210';
    const createdUser = {
      id: 'new-customer-1',
      email: null,
      phone,
      fullName: 'New Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'generated-hash',
    };
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(createdUser);

    const otpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone, role: 'CUSTOMER' })
      .expect(200);

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, role: 'CUSTOMER', otp: otpResponse.body.data.otp })
      .expect(200);

    expect(verifyResponse.body.data.user.role).toBe('CUSTOMER');
    expect(verifyResponse.body.data.token).toEqual(expect.any(String));
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone, role: 'CUSTOMER', email: null }),
    });
    expect(prisma.customerProfile.create).toHaveBeenCalledWith({
      data: { userId: createdUser.id },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, role: 'CUSTOMER', otp: otpResponse.body.data.otp })
      .expect(401);
  });

  it('registers a new professional with a professional profile', async () => {
    const phone = '+919876543211';
    const createdUser = {
      id: 'new-professional-1',
      email: null,
      phone,
      fullName: 'New Professional',
      role: 'PROFESSIONAL',
      status: 'ACTIVE',
      passwordHash: 'generated-hash',
    };
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(createdUser);

    const otpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone, role: 'PROFESSIONAL' })
      .expect(200);

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, role: 'PROFESSIONAL', otp: otpResponse.body.data.otp })
      .expect(200);

    expect(verifyResponse.body.data.user.role).toBe('PROFESSIONAL');
    expect(prisma.professionalProfile.create).toHaveBeenCalledWith({
      data: { userId: createdUser.id, businessName: 'New Professional' },
    });
  });

  it('directs an existing phone number to login instead of changing its role', async () => {
    prisma.user.create.mockClear();
    prisma.user.findUnique.mockResolvedValue({
      id: 'existing-customer',
      email: 'existing@helpzy.test',
      phone: '+919800000002',
      fullName: 'Existing Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'hashed',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone: '+919800000002', role: 'PROFESSIONAL' })
      .expect(409);

    expect(response.body.error.message).toContain('Please log in instead');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects ADMIN on both public registration endpoints', async () => {
    prisma.user.create.mockClear();
    await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone: '+919876543212', role: 'ADMIN' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone: '+919876543212', role: 'ADMIN', otp: '123456' })
      .expect(400);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a registration OTP after it expires', async () => {
    prisma.user.create.mockClear();
    prisma.user.findUnique.mockResolvedValue(null);
    const phone = '+919876543214';
    const originalNow = Date.now();
    let currentNow = originalNow;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentNow);

    try {
      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'CUSTOMER' })
        .expect(200);

      currentNow += app.get<AppConfigRef>(APP_CONFIG).otpTtlSeconds * 1000 + 1;

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone, role: 'CUSTOMER', otp: otpResponse.body.data.otp })
        .expect(401);

      expect(prisma.user.create).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('binds registration OTP verification to the originally requested role', async () => {
    const phone = '+919876543213';
    const createdUser = {
      id: 'role-bound-customer',
      email: null,
      phone,
      fullName: 'New Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'generated-hash',
    };
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(createdUser);

    const otpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone, role: 'CUSTOMER' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, role: 'PROFESSIONAL', otp: otpResponse.body.data.otp })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, role: 'CUSTOMER', otp: otpResponse.body.data.otp })
      .expect(200);
  });

  it('requires admin MFA before the admin-only route is allowed', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@helpzy.test',
      phone: '+919800000001',
      fullName: 'Aditi Rao',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000001' })
      .expect(200);

    const adminToken = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '+919800000001', otp: loginResponse.body.data.otp })
      .expect(200);

    const adminRouteResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken.body.data.token}`)
      .expect(403);

    expect(adminRouteResponse.body.error.code).toBe('MFA_REQUIRED');

    const mfaResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/admin/verify-mfa')
      .set('Authorization', `Bearer ${adminToken.body.data.token}`)
      .send({ code: '000000' })
      .expect(200);

    expect(mfaResponse.body.data.user.role).toBe('ADMIN');
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';
import { DEMO_ADMIN_MFA_CODE } from '../src/auth/auth.service';
import type { AppConfig } from '../src/config/env';

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
    location: { findUnique: jest.Mock };
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
      // Present so `LocationCatalogService` can resolve a slug. Default `null` is
      // the honest stub for a suite that never seeds places, and it keeps the
      // pre-location registration assertions below meaningful.
      location: { findUnique: jest.fn(async () => null) },
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
        location: prisma.location,
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

  /*
   * Location persistence. Three cases only: a slug is stored, an omitted slug
   * stores nothing, and an unknown slug is refused before a code is spent.
   */
  describe('professional registration location', () => {
    const TIRUPATI = {
      id: 'location-tirupati',
      slug: 'ap-tirupati-tirupati',
      state: 'Andhra Pradesh',
      district: 'Tirupati',
      city: 'Tirupati',
    };
    const VIJAYAWADA = {
      id: 'location-vijayawada',
      slug: 'ap-ntr-vijayawada',
      state: 'Andhra Pradesh',
      district: 'NTR',
      city: 'Vijayawada',
    };

    // A distinct phone per test: `AuthService` allows three OTP requests for one
    // number per ten minutes, so reusing a single number would make these fail on
    // rate limiting rather than on the behaviour they are about.
    const PHONE_SLUG = '+9198765432%02d';

    beforeEach(() => {
      prisma.professionalProfile.create.mockClear();
      prisma.user.create.mockClear();
      prisma.user.findUnique.mockReset();
      prisma.user.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'placed-professional',
          email: null,
          phone: data.phone,
          fullName: 'Placed Professional',
          role: 'PROFESSIONAL',
          status: 'ACTIVE',
          passwordHash: 'generated-hash',
        }),
      );
    });

    afterEach(() => {
      prisma.location.findUnique.mockReset();
      prisma.location.findUnique.mockResolvedValue(null);
    });

    it('stores the resolved location id on the new professional profile', async () => {
      const phone = PHONE_SLUG.replace('%02d', '12');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.location.findUnique.mockResolvedValue(TIRUPATI);

      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'PROFESSIONAL', locationSlug: TIRUPATI.slug })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({
          phone,
          role: 'PROFESSIONAL',
          otp: otpResponse.body.data.otp,
          locationSlug: TIRUPATI.slug,
        })
        .expect(200);

      // The id, never the slug or a name: the slug is what the dataset uses, the
      // column is a reference.
      expect(prisma.professionalProfile.create).toHaveBeenCalledWith({
        data: {
          userId: 'placed-professional',
          businessName: 'New Professional',
          locationId: TIRUPATI.id,
        },
      });
    });

    it('leaves the location unset when the professional skips the picker', async () => {
      const phone = PHONE_SLUG.replace('%02d', '13');
      prisma.user.findUnique.mockResolvedValue(null);

      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'PROFESSIONAL' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone, role: 'PROFESSIONAL', otp: otpResponse.body.data.otp })
        .expect(200);

      // No `locationId: null` either - absent is how "not chosen" is stored, so a
      // later profile update can distinguish it from an explicit clear.
      expect(prisma.professionalProfile.create).toHaveBeenCalledWith({
        data: { userId: 'placed-professional', businessName: 'New Professional' },
      });
      expect(prisma.location.findUnique).not.toHaveBeenCalled();
    });

    it('refuses an unknown slug at the request stage, before any code is issued', async () => {
      const phone = PHONE_SLUG.replace('%02d', '14');
      prisma.user.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'PROFESSIONAL', locationSlug: 'ap-nowhere-nowhere' })
        .expect(400);

      expect(prisma.location.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a slug that is well-formed but not in the dataset', async () => {
      const phone = PHONE_SLUG.replace('%02d', '15');
      prisma.user.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'PROFESSIONAL', locationSlug: 'atlantis-mars-city' })
        .expect(400);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('reports an unseeded dataset as a server problem, not a bad request', async () => {
      const phone = PHONE_SLUG.replace('%02d', '16');
      prisma.user.findUnique.mockResolvedValue(null);
      // The slug is real but the row is missing because the location seed has not
      // been run. The professional did nothing wrong.
      prisma.location.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone, role: 'PROFESSIONAL', locationSlug: VIJAYAWADA.slug })
        .expect(503);
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
      .send({ code: DEMO_ADMIN_MFA_CODE })
      .expect(200);

    expect(mfaResponse.body.data.user.role).toBe('ADMIN');
  });

  /**
   * The demo second factor.
   *
   * The code is a fixed, shared value so a presenter can type it, which means it
   * is not a secret. These tests pin the behaviour that still has to hold: it is
   * the only accepted value, the challenge is still single-use, still expires,
   * still spends a bounded number of attempts, and still only ever completes for
   * an account the database says is an admin.
   */
  describe('admin MFA second factor', () => {
    function account(overrides: { id: string; phone: string; role: string; fullName: string }) {
      return {
        id: overrides.id,
        email: `${overrides.id}@helpzy.test`,
        phone: overrides.phone,
        fullName: overrides.fullName,
        role: overrides.role,
        status: 'ACTIVE',
        passwordHash: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    /**
     * Signs in and returns the session token, which still carries no MFA claim.
     *
     * Each caller uses its own phone number: the OTP request budget is three per
     * number per window, and these tests would otherwise exhaust each other's.
     */
    async function signIn(user: ReturnType<typeof account>) {
      prisma.user.findUnique.mockResolvedValue(user);

      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: user.phone })
        .expect(200);

      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: user.phone, otp: otpResponse.body.data.otp })
        .expect(200);

      // The code must never travel to the client.
      expect(JSON.stringify(verified.body)).not.toContain(DEMO_ADMIN_MFA_CODE);

      return verified.body.data.token as string;
    }

    it('completes with the demo code and then opens the admin route', async () => {
      const token = await signIn(
        account({
          id: 'admin-mfa-ok',
          phone: '+919800000011',
          role: 'ADMIN',
          fullName: 'Aditi Rao',
        }),
      );

      const blocked = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(blocked.body.error.code).toBe('MFA_REQUIRED');

      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: DEMO_ADMIN_MFA_CODE })
        .expect(200);

      expect(verified.body.data.mfaRequired).toBe(false);
      expect(verified.body.data.user.mfaVerified).toBe(true);
      expect(JSON.stringify(verified.body)).not.toContain(DEMO_ADMIN_MFA_CODE);

      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${verified.body.data.token}`)
        .expect(200);
    });

    it('rejects any other code', async () => {
      const token = await signIn(
        account({
          id: 'admin-mfa-wrong',
          phone: '+919800000012',
          role: 'ADMIN',
          fullName: 'Aditi Rao',
        }),
      );

      const rejected = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '999999' })
        .expect(401);

      expect(rejected.body.error.code).toBe('MFA_INVALID');
      expect(rejected.body.error.message).toBe(
        'The MFA code does not match the one that was issued.',
      );
    });

    it('keeps the attempt ceiling, so a wrong code cannot be brute forced', async () => {
      const token = await signIn(
        account({
          id: 'admin-mfa-brute',
          phone: '+919800000013',
          role: 'ADMIN',
          fullName: 'Aditi Rao',
        }),
      );

      for (let attempt = 0; attempt < 5; attempt++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/admin/verify-mfa')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: '999999' })
          .expect(401);
      }

      // The challenge is spent, so even the correct code no longer works.
      const spent = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: DEMO_ADMIN_MFA_CODE })
        .expect(401);

      expect(spent.body.error.message).toBe('The MFA code is invalid or has expired.');
    });

    it('rejects a challenge that has expired', async () => {
      // Read here rather than at describe scope: `app` only exists after the
      // enclosing beforeAll has run.
      const mfaTtlSeconds = app.get<AppConfigRef>(APP_CONFIG).mfaTtlSeconds;
      const originalNow = Date.now();
      let currentNow = originalNow;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentNow);

      try {
        const token = await signIn(
          account({
            id: 'admin-mfa-stale',
            phone: '+919800000014',
            role: 'ADMIN',
            fullName: 'Aditi Rao',
          }),
        );

        currentNow += mfaTtlSeconds * 1000 + 1;

        const stale = await request(app.getHttpServer())
          .post('/api/v1/auth/admin/verify-mfa')
          .set('Authorization', `Bearer ${token}`)
          .send({ code: DEMO_ADMIN_MFA_CODE })
          .expect(401);

        expect(stale.body.error.code).toBe('MFA_INVALID');
        expect(stale.body.error.message).toBe('The MFA code is invalid or has expired.');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('refuses a non-admin session even when the code is correct', async () => {
      const token = await signIn(
        account({
          id: 'professional-mfa',
          phone: '+919800000015',
          role: 'PROFESSIONAL',
          fullName: 'Meera Iyer',
        }),
      );

      const refused = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/verify-mfa')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: DEMO_ADMIN_MFA_CODE })
        .expect(403);

      expect(refused.body.error.code).toBe('FORBIDDEN');

      // And the role guard is unchanged: no admin route opens for a professional.
      const blocked = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(blocked.body.error.code).toBe('FORBIDDEN');
    });
  });
});

function buildProductionConfig(): AppConfig {
  return {
    nodeEnv: 'production',
    isProduction: true,
    logLevel: 'log',
    port: 4000,
    host: '0.0.0.0',
    globalPrefix: 'api/v1',
    corsOrigins: ['http://localhost:8081'],
    databaseUrl: undefined,
    authJwtSecret: 'a'.repeat(32),
    authTokenTtlSeconds: 86_400,
    otpTtlSeconds: 300,
    mfaTtlSeconds: 300,
    authDemoOtpEnabled: false,
    mediaUploadDir: '/tmp/helpzy-uploads',
    mediaPublicBaseUrl: '/media',
    mediaMaxBytes: 5 * 1024 * 1024,
    privateMediaUploadDir: '/tmp/helpzy-private-uploads',
    webClientDir: '',
    paymentOnlineProvider: undefined,
    paymentOnlineApiKey: undefined,
    paymentWebhookSecret: '',
    paymentSandboxCheckoutBaseUrl: 'http://localhost:4000/api/v1/payments/sandbox/checkout',
    locationStaleMinutes: 15,
    timezone: 'Asia/Kolkata',
  };
}

/** Row shape of the two generated OTP challenge tables. */
interface OtpChallengeRow {
  phone: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  userId?: string;
  role?: string;
}

interface OtpChallengeDelegate {
  upsert: jest.Mock;
  findUnique: jest.Mock;
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
}

interface PhoneArgs {
  where: { phone: string };
}

interface UpsertArgs extends PhoneArgs {
  create: Partial<OtpChallengeRow>;
  update: Partial<OtpChallengeRow>;
}

interface IncrementArgs extends PhoneArgs {
  data: { attempts: { increment: number } };
}

interface DeleteArgs {
  where: { phone: string; attempts?: { gte: number } };
}

describe('Demo OTP (production mode)', () => {
  let app: INestApplication;
  /** Every application booted here, so the multi-instance cases all get closed. */
  const createdApps: INestApplication[] = [];
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
    otpChallenge: OtpChallengeDelegate;
    registrationOtpChallenge: OtpChallengeDelegate;
  };

  function createOtpChallengeStore(): {
    login: OtpChallengeDelegate;
    registration: OtpChallengeDelegate;
  } {
    const build = (): OtpChallengeDelegate => {
      const rows = new Map<string, OtpChallengeRow>();

      return {
        upsert: jest.fn((args: UpsertArgs) => {
          const next: OtpChallengeRow = {
            phone: args.where.phone,
            code: args.update.code ?? args.create.code ?? '',
            expiresAt: args.update.expiresAt ?? args.create.expiresAt ?? new Date(),
            attempts: args.update.attempts ?? args.create.attempts ?? 0,
            userId: args.update.userId ?? args.create.userId,
            role: args.update.role ?? args.create.role,
          };
          rows.set(args.where.phone, next);
          return Promise.resolve(next);
        }),
        findUnique: jest.fn((args: PhoneArgs) =>
          Promise.resolve(rows.get(args.where.phone) ?? null),
        ),
        updateMany: jest.fn((args: IncrementArgs) => {
          const existing = rows.get(args.where.phone);
          if (!existing) {
            return Promise.resolve({ count: 0 });
          }

          rows.set(args.where.phone, {
            ...existing,
            attempts: existing.attempts + args.data.attempts.increment,
          });
          return Promise.resolve({ count: 1 });
        }),
        deleteMany: jest.fn((args: DeleteArgs) => {
          const existing = rows.get(args.where.phone);
          const ceiling = args.where.attempts?.gte;

          if (!existing || (ceiling !== undefined && existing.attempts < ceiling)) {
            return Promise.resolve({ count: 0 });
          }

          rows.delete(args.where.phone);
          return Promise.resolve({ count: 1 });
        }),
      };
    };

    return { login: build(), registration: build() };
  }

  async function createProductionApp(
    config: AppConfig,
    challengeStore?: { login: OtpChallengeDelegate; registration: OtpChallengeDelegate },
  ): Promise<{
    app: INestApplication;
    prisma: typeof prisma;
  }> {
    const store = challengeStore ?? createOtpChallengeStore();
    const prismaInstance = {
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
      otpChallenge: store.login,
      registrationOtpChallenge: store.registration,
    };

    const transaction = {
      user: prismaInstance.user,
      customerProfile: prismaInstance.customerProfile,
      professionalProfile: prismaInstance.professionalProfile,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $transaction: jest.fn((operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
        ),
        user: prismaInstance.user,
        customerProfile: prismaInstance.customerProfile,
        professionalProfile: prismaInstance.professionalProfile,
        serviceCategory: prismaInstance.serviceCategory,
        service: prismaInstance.service,
        review: prismaInstance.review,
        booking: prismaInstance.booking,
        otpChallenge: prismaInstance.otpChallenge,
        registrationOtpChallenge: prismaInstance.registrationOtpChallenge,
      })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();

    const nestApp = moduleRef.createNestApplication();
    configureApp(nestApp, config);
    await nestApp.init();
    createdApps.push(nestApp);

    return { app: nestApp, prisma: prismaInstance };
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await Promise.all(createdApps.map((created) => created.close()));
  });

  it('returns the demo OTP in production when AUTH_DEMO_OTP_ENABLED is true', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = true;
    ({ app, prisma } = await createProductionApp(config));

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

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('OTP_SENT');
    expect(response.body.data.otp).toEqual(expect.any(String));
    expect(response.body.data.otp).toHaveLength(6);
  });

  it('does not return the demo OTP in production when AUTH_DEMO_OTP_ENABLED is false', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = false;
    ({ app, prisma } = await createProductionApp(config));

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

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('OTP_SENT');
    expect(response.body.data.otp).toBeUndefined();
  });

  it('returns the demo registration OTP in production when enabled', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = true;
    ({ app, prisma } = await createProductionApp(config));

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'new-customer-1',
      email: null,
      phone: '+919876543210',
      fullName: 'New Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'generated-hash',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone: '+919876543210', role: 'CUSTOMER' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('OTP_SENT');
    expect(response.body.data.otp).toEqual(expect.any(String));
    expect(response.body.data.otp).toHaveLength(6);
  });

  it('does not return the demo registration OTP in production when disabled', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = false;
    ({ app, prisma } = await createProductionApp(config));

    prisma.user.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone: '+919876543210', role: 'CUSTOMER' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('OTP_SENT');
    expect(response.body.data.otp).toBeUndefined();
  });

  it('rejects verification after too many wrong attempts', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = true;
    ({ app, prisma } = await createProductionApp(config));

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

    const otpResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002' })
      .expect(200);

    const wrongOtp = '000000';
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: '+919800000002', otp: wrongOtp })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '+919800000002', otp: otpResponse.body.data.otp })
      .expect(401);
  });

  it('rejects an expired OTP in production', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = true;
    ({ app, prisma } = await createProductionApp(config));

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

    const originalNow = Date.now();
    let currentNow = originalNow;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentNow);

    try {
      const otpResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: '+919800000002' })
        .expect(200);

      currentNow += config.otpTtlSeconds * 1000 + 1;

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: '+919800000002', otp: otpResponse.body.data.otp })
        .expect(401);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('throttles excessive OTP requests from the same phone number', async () => {
    const config = buildProductionConfig();
    config.authDemoOtpEnabled = true;
    ({ app, prisma } = await createProductionApp(config));

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

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: '+919800000002' })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: '+919800000002' })
      .expect(429);
  });

  /**
   * Regression coverage for the production report: an OTP was issued on one
   * Render instance and rejected as invalid when the verification reached
   * another one, because the challenge lived in per-process memory.
   *
   * Each case boots two independent Nest applications and gives them one shared
   * challenge store, which is the shape a single database presents to a fleet of
   * instances.
   */
  describe('shared challenge storage across application instances', () => {
    const REGISTRATION_PHONE = '+919876543211';
    const CUSTOMER = {
      id: 'customer-1',
      email: 'customer@helpzy.test',
      phone: '+919800000002',
      fullName: 'Rahul Verma',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    async function createInstancePair() {
      const config = buildProductionConfig();
      config.authDemoOtpEnabled = true;

      const store = createOtpChallengeStore();
      const first = await createProductionApp(config, store);
      const second = await createProductionApp(config, store);

      return { first, second };
    }

    it('accepts a registration OTP issued by a different instance', async () => {
      const { first, second } = await createInstancePair();

      first.prisma.user.findUnique.mockResolvedValue(null);
      second.prisma.user.findUnique.mockResolvedValue(null);
      second.prisma.user.create.mockResolvedValue({
        id: 'new-customer-1',
        email: null,
        phone: REGISTRATION_PHONE,
        fullName: 'New Customer',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        passwordHash: 'generated-hash',
      });

      const otpResponse = await request(first.app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone: REGISTRATION_PHONE, role: 'CUSTOMER' })
        .expect(200);

      const otp = otpResponse.body.data.otp;
      expect(otp).toEqual(expect.any(String));

      const verifyResponse = await request(second.app.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone: REGISTRATION_PHONE, otp, role: 'CUSTOMER' })
        .expect(200);

      expect(verifyResponse.body.success).toBe(true);
      expect(verifyResponse.body.data.user.phone).toBe(REGISTRATION_PHONE);
    });

    it('accepts a sign-in OTP issued by a different instance', async () => {
      const { first, second } = await createInstancePair();

      first.prisma.user.findUnique.mockResolvedValue(CUSTOMER);
      second.prisma.user.findUnique.mockResolvedValue(CUSTOMER);

      const otpResponse = await request(first.app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: CUSTOMER.phone })
        .expect(200);

      const otp = otpResponse.body.data.otp;
      expect(otp).toEqual(expect.any(String));

      const verifyResponse = await request(second.app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: CUSTOMER.phone, otp })
        .expect(200);

      expect(verifyResponse.body.success).toBe(true);
      expect(verifyResponse.body.data.user.id).toBe(CUSTOMER.id);
    });

    it('spends a code once, even when two instances race for it', async () => {
      const { first, second } = await createInstancePair();

      first.prisma.user.findUnique.mockResolvedValue(null);
      second.prisma.user.findUnique.mockResolvedValue(null);
      second.prisma.user.create.mockResolvedValue({
        id: 'new-customer-1',
        email: null,
        phone: REGISTRATION_PHONE,
        fullName: 'New Customer',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        passwordHash: 'generated-hash',
      });

      const otpResponse = await request(first.app.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone: REGISTRATION_PHONE, role: 'CUSTOMER' })
        .expect(200);

      const otp = otpResponse.body.data.otp;

      const [winner, loser] = await Promise.all([
        request(second.app.getHttpServer())
          .post('/api/v1/auth/register/verify-otp')
          .send({ phone: REGISTRATION_PHONE, otp, role: 'CUSTOMER' }),
        request(first.app.getHttpServer())
          .post('/api/v1/auth/register/verify-otp')
          .send({ phone: REGISTRATION_PHONE, otp, role: 'CUSTOMER' }),
      ]);

      expect([winner.status, loser.status].sort()).toEqual([200, 401]);
    });

    it('shares the wrong-attempt ceiling between instances', async () => {
      const { first, second } = await createInstancePair();

      first.prisma.user.findUnique.mockResolvedValue(CUSTOMER);
      second.prisma.user.findUnique.mockResolvedValue(CUSTOMER);

      const otpResponse = await request(first.app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: CUSTOMER.phone })
        .expect(200);

      const otp = otpResponse.body.data.otp;

      for (let i = 0; i < 5; i++) {
        await request(first.app.getHttpServer())
          .post('/api/v1/auth/verify-otp')
          .send({ phone: CUSTOMER.phone, otp: '000000' })
          .expect(401);
      }

      await request(second.app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: CUSTOMER.phone, otp })
        .expect(401);
    });
  });
});

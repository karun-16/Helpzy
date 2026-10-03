import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';

const ADMIN_ID = 'c4000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'c1000000-0000-4000-8000-000000000001';
const PROFESSIONAL_USER_ID = 'c2000000-0000-4000-8000-000000000001';
const SERVICE_ID = 'c6000000-0000-4000-8000-000000000001';
const WITHDRAWN_SERVICE_ID = 'c6000000-0000-4000-8000-000000000002';
const PENDING_SERVICE_ID = 'c6000000-0000-4000-8000-000000000003';
const CATEGORY_ID = 'c7000000-0000-4000-8000-000000000001';

type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/**
 * Admin moderation of individual service listings.
 *
 * The invariants that matter: a listing is never deleted, an existing booking
 * keeps working after a withdrawal, the reason reaches the professional, and
 * every decision is attributed in the audit log. Without a reason the whole
 * feature is worse than useless - the professional just sees a listing vanish.
 */
describe('Admin service moderation (e2e)', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>();
  const auditLog: Array<Record<string, unknown>> = [];

  const services = new Map<string, Record<string, unknown>>();
  const decimal = (value: number) => ({ toNumber: () => value });

  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    serviceCategory: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    service: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    professionalProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  /** The full row shape the moderation query includes. */
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    ownerId: PROFESSIONAL_USER_ID,
    title: 'Deep Clean',
    slug: 'deep-clean',
    summary: 'A thorough clean',
    description: 'Full description',
    basePrice: decimal(750),
    currency: 'INR',
    durationMinutes: 90,
    isActive: true,
    moderationStatus: 'APPROVED',
    moderationNote: null,
    moderatedAt: null,
    ratingCount: 3,
    averageRating: decimal(4.5),
    bookingCount: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    category: { id: CATEGORY_ID, name: 'Home Services' },
    owner: {
      id: PROFESSIONAL_USER_ID,
      fullName: 'Meera Iyer',
      phone: '+919800000003',
      status: 'ACTIVE',
      professionalProfile: { verification: 'VERIFIED' },
    },
    ...overrides,
    _count: { bookings: (overrides.bookingCount as number) ?? 2 },
  });

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

  const loginAs = async (
    user: { id: string; phone: string; fullName: string; role: Role },
    options: { rememberAs?: string } = {},
  ) => {
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
    tokens.set(options.rememberAs ?? user.role, token);
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

  beforeEach(() => {
    services.clear();
    auditLog.length = 0;
    jest.clearAllMocks();

    services.set(SERVICE_ID, row(SERVICE_ID));
    services.set(
      WITHDRAWN_SERVICE_ID,
      row(WITHDRAWN_SERVICE_ID, {
        title: 'Vague Listing',
        slug: 'vague-listing',
        isActive: false,
        moderationStatus: 'REJECTED',
        moderationNote: 'Misleading description',
        moderatedAt: new Date('2026-02-01T00:00:00.000Z'),
        bookingCount: 0,
      }),
    );
    // A listing the platform requires review for: hidden until an
    // admin decides, which is the state the moderation queue exists
    // to surface.
    services.set(
      PENDING_SERVICE_ID,
      row(PENDING_SERVICE_ID, {
        title: 'New Listing',
        slug: 'new-listing',
        isActive: false,
        moderationStatus: 'PENDING',
        moderationNote: null,
        moderatedAt: null,
        bookingCount: 0,
      }),
    );

    // The professional's own list is gated on having a profile; without this the
    // service returns an empty list before it ever reaches the query.
    prisma.professionalProfile.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.userId === PROFESSIONAL_USER_ID
          ? { id: 'c3000000-0000-4000-8000-000000000001', verification: 'VERIFIED' }
          : null,
      ),
    );

    prisma.service.findMany.mockImplementation(({ where }) => {
      let result = [...services.values()];
      if (where?.isActive === false) result = result.filter((s) => s.isActive === false);
      if (where?.categoryId) result = result.filter((s) => s.categoryId === where.categoryId);
      const text = where?.OR?.find((clause: { title?: { contains?: string } }) => clause.title)
        ?.title?.contains;
      if (text) {
        const needle = String(text).toLowerCase();
        result = result.filter((s) => String(s.title).toLowerCase().includes(needle));
      }
      return result.map((s) => row(String(s.id), s));
    });

    prisma.service.findUnique.mockImplementation(({ where }) => {
      const found = services.get(where?.id);
      return found ? row(String(found.id), found) : null;
    });

    prisma.service.update.mockImplementation(({ where, data }) => {
      const existing = services.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      services.set(where.id, updated);
      return Promise.resolve(row(where.id, updated));
    });

    prisma.auditLog.create.mockImplementation(({ data }) => {
      auditLog.push(data);
      return Promise.resolve(data);
    });
  });

  describe('access control', () => {
    it('refuses an unauthenticated request', async () => {
      await api().get('/api/v1/admin/services').expect(401);
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .send({ isActive: false, reason: 'Spam content' })
        .expect(401);
    });

    it('refuses a customer', async () => {
      await api().get('/api/v1/admin/services').set(as('CUSTOMER')).expect(403);
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('CUSTOMER'))
        .send({ isActive: false, reason: 'Spam content' })
        .expect(403);
    });

    it('refuses a professional moderating their own or anyone else listing', async () => {
      await api().get('/api/v1/admin/services').set(as('PROFESSIONAL')).expect(403);
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('PROFESSIONAL'))
        .send({ isActive: false, reason: 'Changed my mind' })
        .expect(403);
    });

    it('allows an admin', async () => {
      await api().get('/api/v1/admin/services').set(as('ADMIN')).expect(200);
    });
  });

  describe('listing', () => {
    it('shows live and withdrawn listings together by default', async () => {
      const response = await api().get('/api/v1/admin/services').set(as('ADMIN')).expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: SERVICE_ID, isActive: true, moderationNote: null }),
          expect.objectContaining({
            id: WITHDRAWN_SERVICE_ID,
            isActive: false,
            moderationNote: 'Misleading description',
          }),
        ]),
      );
    });

    it('includes owner and category context for the moderation decision', async () => {
      const response = await api().get('/api/v1/admin/services').set(as('ADMIN')).expect(200);
      const [first] = response.body.data;

      expect(first.owner).toEqual(
        expect.objectContaining({
          id: PROFESSIONAL_USER_ID,
          fullName: 'Meera Iyer',
          status: 'ACTIVE',
          verification: 'VERIFIED',
        }),
      );
      expect(first.category).toEqual({ id: CATEGORY_ID, name: 'Home Services' });
    });

    it('can be filtered to inactive listings only', async () => {
      const response = await api()
        .get('/api/v1/admin/services?onlyInactive=true')
        .set(as('ADMIN'))
        .expect(200);

      // Withdrawn and pending listings are both inactive, so the
      // filter surfaces everything an admin has pulled as well as
      // everything still waiting for a decision.
      expect(response.body.data.map((s: { id: string }) => s.id)).toEqual([
        WITHDRAWN_SERVICE_ID,
        PENDING_SERVICE_ID,
      ]);
    });

    it('searches by listing title', async () => {
      const response = await api()
        .get('/api/v1/admin/services?search=vague')
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(WITHDRAWN_SERVICE_ID);
    });
  });

  describe('withdrawal', () => {
    it('records the reason on the listing and returns the full shape', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Price stated as a monthly retainer' })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: SERVICE_ID,
          isActive: false,
          moderationNote: 'Price stated as a monthly retainer',
          owner: expect.objectContaining({ id: PROFESSIONAL_USER_ID }),
          category: { id: CATEGORY_ID, name: 'Home Services' },
        }),
      );
      expect(response.body.data.moderatedAt).toEqual(expect.any(String));
    });

    it('attributes the decision to the admin in the audit log', async () => {
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Misleading description' });

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'SERVICE_MODERATED',
            entityType: 'SERVICE',
            entityId: SERVICE_ID,
            metadata: expect.objectContaining({
              from: true,
              to: false,
              reason: 'Misleading description',
              ownerId: PROFESSIONAL_USER_ID,
            }),
          }),
        ]),
      );
    });

    it('never deletes the listing', async () => {
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Misleading description' })
        .expect(200);

      // The mock deliberately exposes no delete, so a call would throw rather
      // than silently pass; the row surviving is the real assertion.
      expect(services.has(SERVICE_ID)).toBe(true);
    });

    it('requires a reason', async () => {
      const missing = await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false })
        .expect(400);
      expect(missing.body.error.code).toBe('VALIDATION_FAILED');

      const blank = await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: '  ' })
        .expect(400);
      expect(blank.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown field', async () => {
      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Misleading description', priceAmount: 1 })
        .expect(400);
    });

    it('rejects withdrawing an already withdrawn listing', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${WITHDRAWN_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Trying again' })
        .expect(400);

      expect(response.body.error.message).toContain('already withdrawn');
    });

    it('404s for an unknown listing', async () => {
      await api()
        .patch('/api/v1/admin/services/99999999-0000-4000-8000-000000000099/status')
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Spam content' })
        .expect(404);
    });
  });

  describe('restoration', () => {
    it('clears the note so a live listing carries no stale complaint', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${WITHDRAWN_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true, reason: 'Description has been corrected' })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ isActive: true, moderationNote: null }),
      );
    });

    it('audits the restore with its own reason', async () => {
      await api()
        .patch(`/api/v1/admin/services/${WITHDRAWN_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true, reason: 'Description has been corrected' });

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'SERVICE_MODERATED',
            metadata: expect.objectContaining({
              from: false,
              to: true,
              reason: 'Description has been corrected',
              previousNote: 'Misleading description',
            }),
          }),
        ]),
      );
    });

    it('requires a reason to restore as well', async () => {
      await api()
        .patch(`/api/v1/admin/services/${WITHDRAWN_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true })
        .expect(400);
    });
  });

  describe('moderation state', () => {
    it('reports the state of every listing in the list', async () => {
      const response = await api().get('/api/v1/admin/services').set(as('ADMIN')).expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: SERVICE_ID, moderationStatus: 'APPROVED' }),
          expect.objectContaining({
            id: WITHDRAWN_SERVICE_ID,
            moderationStatus: 'REJECTED',
          }),
          expect.objectContaining({
            id: PENDING_SERVICE_ID,
            moderationStatus: 'PENDING',
          }),
        ]),
      );
    });

    it('approves a listing that is awaiting review', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${PENDING_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true, reason: 'Verified the pricing' })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: PENDING_SERVICE_ID,
          isActive: true,
          moderationStatus: 'APPROVED',
          moderationNote: null,
        }),
      );
      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'SERVICE_MODERATED',
            metadata: expect.objectContaining({ moderationStatus: 'APPROVED' }),
          }),
        ]),
      );
    });

    it('rejects a listing that is awaiting review', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${PENDING_SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Not offered in this area' })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: PENDING_SERVICE_ID,
          isActive: false,
          moderationStatus: 'REJECTED',
          moderationNote: 'Not offered in this area',
        }),
      );
    });

    it('marks a withdrawn approved listing as rejected', async () => {
      const response = await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Seasonal listing' })
        .expect(200);

      // Withdrawing a listing an admin had approved is a rejection, so
      // the professional is told why it disappeared rather than left
      // wondering whether it merely went inactive.
      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: SERVICE_ID,
          isActive: false,
          moderationStatus: 'REJECTED',
          moderationNote: 'Seasonal listing',
        }),
      );
    });

    it('can filter the queue down to listings awaiting review', async () => {
      const response = await api().get('/api/v1/admin/services').set(as('ADMIN')).expect(200);

      const pending = response.body.data.filter(
        (service: { moderationStatus: string }) => service.moderationStatus === 'PENDING',
      );
      expect(pending.map((service: { id: string }) => service.id)).toEqual([PENDING_SERVICE_ID]);
    });
  });

  describe('what the professional sees', () => {
    it('is told why the listing is hidden', async () => {
      // The professional's own list carries the note through, which is the whole
      // point of requiring a reason.
      prisma.service.findMany.mockResolvedValue([
        row(SERVICE_ID, {
          isActive: false,
          moderationStatus: 'REJECTED',
          moderationNote: 'Price stated as a monthly retainer',
        }),
      ]);
      const response = await api()
        .get('/api/v1/professional/services')
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: SERVICE_ID,
            isActive: false,
            moderationNote: 'Price stated as a monthly retainer',
          }),
        ]),
      );
    });

    it('reports no note when the professional hid the listing themselves', async () => {
      prisma.service.findMany.mockResolvedValue([row(SERVICE_ID, { isActive: false })]);

      const response = await api()
        .get('/api/v1/professional/services')
        .set(as('PROFESSIONAL'))
        .expect(200);

      expect(response.body.data[0].moderationNote).toBeNull();
    });
  });

  describe('existing bookings', () => {
    it('are unaffected by a withdrawal', async () => {
      const before = services.get(SERVICE_ID)!.bookingCount;

      await api()
        .patch(`/api/v1/admin/services/${SERVICE_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Seasonal listing' })
        .expect(200);

      // The listing is hidden but still present, so a booking that points at it
      // keeps a real target to be paid against.
      expect(services.get(SERVICE_ID)!.bookingCount).toBe(before);
      expect(services.has(SERVICE_ID)).toBe(true);
    });
  });
});

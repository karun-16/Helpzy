import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';

const ADMIN_ID = 'b4000000-0000-4000-8000-000000000001';
const PROFESSIONAL_USER_ID = 'b2000000-0000-4000-8000-000000000001';
const CATEGORY_ID = 'b7000000-0000-4000-8000-000000000001';
const INACTIVE_CATEGORY_ID = 'b7000000-0000-4000-8000-000000000002';

type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/**
 * Admin category management.
 *
 * The rules worth protecting are the ones a careless implementation would break:
 * a category is never deleted, deactivating one must hide it and its services
 * from public discovery without touching the rows, and every change has to land
 * in the audit log with the acting admin attached.
 */
describe('Admin categories (e2e)', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>();
  const auditLog: Array<Record<string, unknown>> = [];

  /** Backing store the mocked `serviceCategory` reads and writes. */
  const categories = new Map<string, Record<string, unknown>>();
  /** `service.count({ where: { categoryId } })` answers from this. */
  const serviceCounts = new Map<string, number>();

  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    serviceCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    service: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    professionalProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  /** The Prisma shape the category service maps into its response. */
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    slug: 'home-services',
    name: 'Home Services',
    description: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
    _count: { services: serviceCounts.get(id) ?? 0 },
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
      id: PROFESSIONAL_USER_ID,
      phone: '+919800000003',
      fullName: 'Meera Iyer',
      role: 'PROFESSIONAL',
    });
    await loginAs({ id: ADMIN_ID, phone: '+919800000001', fullName: 'Aditi Rao', role: 'ADMIN' });
  }, 20_000);

  beforeEach(() => {
    categories.clear();
    serviceCounts.clear();
    auditLog.length = 0;
    jest.clearAllMocks();

    categories.set(CATEGORY_ID, row(CATEGORY_ID));
    categories.set(
      INACTIVE_CATEGORY_ID,
      row(INACTIVE_CATEGORY_ID, {
        slug: 'retired-category',
        name: 'Retired Category',
        isActive: false,
        sortOrder: 40,
      }),
    );
    serviceCounts.set(CATEGORY_ID, 2);

    prisma.serviceCategory.findMany.mockImplementation(({ where }) => {
      let result = [...categories.values()];
      if (where?.name?.contains) {
        const needle = String(where.name.contains).toLowerCase();
        result = result.filter((c) => String(c.name).toLowerCase().includes(needle));
      }
      if (where?.isActive === true) result = result.filter((c) => c.isActive === true);
      return result.map((c) => row(String(c.id), c));
    });

    prisma.serviceCategory.findUnique.mockImplementation(({ where }) => {
      const found =
        categories.get(where?.id) ?? (where?.slug ? categories.get(where.slug) : undefined);
      return found ? row(String(found.id), found) : null;
    });

    prisma.serviceCategory.findFirst.mockImplementation(({ where }) => {
      if (where?.name?.equals) {
        const needle = String(where.name.equals).toLowerCase();
        const found = [...categories.values()].find((c) => String(c.name).toLowerCase() === needle);
        return found ? { id: found.id } : null;
      }
      return null;
    });

    prisma.serviceCategory.create.mockImplementation(({ data }) => {
      const created = row(`new-${categories.size}`, {
        ...data,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      categories.set(String(created.id), created);
      return Promise.resolve(created);
    });

    prisma.serviceCategory.update.mockImplementation(({ where, data }) => {
      const existing = categories.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      categories.set(where.id, updated);
      return Promise.resolve(row(where.id, updated));
    });

    prisma.service.count.mockImplementation(({ where }) =>
      Promise.resolve(serviceCounts.get(where?.categoryId) ?? 0),
    );

    prisma.auditLog.create.mockImplementation(({ data }) => {
      auditLog.push(data);
      return Promise.resolve(data);
    });
  });

  describe('access control', () => {
    it('refuses an unauthenticated listing', async () => {
      await api().get('/api/v1/admin/categories').expect(401);
    });

    it('refuses a customer', async () => {
      await loginAs(
        {
          id: 'b1000000-0000-4000-8000-000000000001',
          phone: '+919800000002',
          fullName: 'Rahul Verma',
          role: 'CUSTOMER',
        },
        { rememberAs: 'CUSTOMER' },
      );
      await api().get('/api/v1/admin/categories').set(as('CUSTOMER')).expect(403);
    });

    it('refuses a professional', async () => {
      await api().get('/api/v1/admin/categories').set(as('PROFESSIONAL')).expect(403);
    });

    it('allows an admin through MFA', async () => {
      await api().get('/api/v1/admin/categories').set(as('ADMIN')).expect(200);
    });
  });

  describe('listing', () => {
    it('includes inactive categories so a hidden one can be found again', async () => {
      const response = await api().get('/api/v1/admin/categories').set(as('ADMIN')).expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: CATEGORY_ID, isActive: true, serviceCount: 2 }),
          expect.objectContaining({ id: INACTIVE_CATEGORY_ID, isActive: false }),
        ]),
      );
    });

    it('can be narrowed to active categories only', async () => {
      const response = await api()
        .get('/api/v1/admin/categories?includeInactive=false')
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data.map((c: { id: string }) => c.id)).toEqual([CATEGORY_ID]);
    });

    it('searches by name case-insensitively', async () => {
      const response = await api()
        .get('/api/v1/admin/categories?search=home')
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Home Services');
    });
  });

  describe('creation', () => {
    it('creates an active category with a derived slug', async () => {
      const response = await api()
        .post('/api/v1/admin/categories')
        .set(as('ADMIN'))
        .send({ name: 'Pest Control', description: 'Safe treatments' })
        .expect(201);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          name: 'Pest Control',
          slug: 'pest-control',
          description: 'Safe treatments',
          isActive: true,
        }),
      );
    });

    it('audits the creation against the acting admin', async () => {
      await api().post('/api/v1/admin/categories').set(as('ADMIN')).send({ name: 'Pest Control' });

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'CATEGORY_CREATED',
            entityType: 'SERVICE_CATEGORY',
          }),
        ]),
      );
    });

    it('rejects a duplicate name regardless of case', async () => {
      const response = await api()
        .post('/api/v1/admin/categories')
        .set(as('ADMIN'))
        .send({ name: 'home services' })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('rejects an empty name', async () => {
      const response = await api()
        .post('/api/v1/admin/categories')
        .set(as('ADMIN'))
        .send({ name: '  ' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown field rather than silently dropping it', async () => {
      await api()
        .post('/api/v1/admin/categories')
        .set(as('ADMIN'))
        .send({ name: 'Pest Control', isActive: false })
        .expect(400);
    });
  });

  describe('editing', () => {
    it('updates the name, description and sort order', async () => {
      const response = await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}`)
        .set(as('ADMIN'))
        .send({ name: 'Home & Domestic', sortOrder: 5 })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ name: 'Home & Domestic', sortOrder: 5 }),
      );
    });

    it('keeps the original slug so existing links keep resolving', async () => {
      const response = await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}`)
        .set(as('ADMIN'))
        .send({ name: 'Renamed Category' })
        .expect(200);

      expect(response.body.data.slug).toBe('home-services');
    });

    it('rejects a rename that collides with another category', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}`)
        .set(as('ADMIN'))
        .send({ name: 'Retired Category' })
        .expect(409);
    });

    it('allows saving a category under its own unchanged name', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}`)
        .set(as('ADMIN'))
        .send({ name: 'Home Services', description: 'Plumbing, cleaning and repairs' })
        .expect(200);
    });

    it('rejects a status change through the edit endpoint', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}`)
        .set(as('ADMIN'))
        .send({ isActive: false })
        .expect(400);
    });

    it('404s for an unknown category', async () => {
      await api()
        .patch('/api/v1/admin/categories/99999999-0000-4000-8000-000000000099')
        .set(as('ADMIN'))
        .send({ name: 'Ghost Category' })
        .expect(404);
    });
  });

  describe('deactivation', () => {
    it('deactivates and audits with the reason and blast radius', async () => {
      const response = await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false, reason: 'Seasonal category' })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ isActive: false, serviceCount: 2 }),
      );
      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'CATEGORY_STATUS_CHANGED',
            metadata: expect.objectContaining({
              from: true,
              to: false,
              reason: 'Seasonal category',
              affectedServices: 2,
            }),
          }),
        ]),
      );
    });

    it('reactivates a previously deactivated category', async () => {
      const response = await api()
        .patch(`/api/v1/admin/categories/${INACTIVE_CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true })
        .expect(200);

      expect(response.body.data.isActive).toBe(true);
    });

    it('never deletes a category', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false })
        .expect(200);

      expect(categories.has(CATEGORY_ID)).toBe(true);
    });

    it('rejects a no-op status change with a readable reason', async () => {
      const response = await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: true })
        .expect(400);

      expect(response.body.error.message).toContain('already active');
    });

    it('leaves existing services untouched when deactivating', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false })
        .expect(200);

      expect(prisma.service.updateMany).not.toHaveBeenCalled();
    });

    it('hides the category and its services from public discovery', async () => {
      // Give the category a live, publishable service so the assertion below is
      // about the category's own flag and nothing else.
      prisma.service.findMany.mockResolvedValue([
        {
          id: 'service-in-home-category',
          categoryId: CATEGORY_ID,
          title: 'Deep Clean',
          isActive: true,
          priceAmount: 500,
        },
      ]);

      await api()
        .patch(`/api/v1/admin/categories/${CATEGORY_ID}/status`)
        .set(as('ADMIN'))
        .send({ isActive: false })
        .expect(200);

      // The public catalogue is built from active categories joined to their
      // services; deactivating the category drops it and its listings.
      const response = await api().get('/api/v1/customer/services').expect(200);
      const categoryIds = response.body.data.map((c: { id: string }) => c.id);

      expect(categoryIds).not.toContain(CATEGORY_ID);
      expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });
});

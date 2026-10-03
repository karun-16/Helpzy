import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';

const CUSTOMER_ID = 'd1000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = 'd1000000-0000-4000-8000-000000000002';
const PROFESSIONAL_USER_ID = 'd2000000-0000-4000-8000-000000000001';
const ADMIN_ID = 'd4000000-0000-4000-8000-000000000001';
const SERVICE_ID = 'd6000000-0000-4000-8000-000000000001';
const BOOKING_ID = 'd5000000-0000-4000-8000-000000000001';
const OTHER_BOOKING_ID = 'd5000000-0000-4000-8000-000000000002';
const REPORT_ID = 'd7000000-0000-4000-8000-000000000001';
const DISPUTE_ID = 'd8000000-0000-4000-8000-000000000001';
const REVIEW_ID = 'd9000000-0000-4000-8000-000000000001';

type Role = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

/**
 * Reporting and dispute management.
 *
 * These two features are where a careless implementation is most expensive, so
 * the tests concentrate on the properties that must not break:
 *
 * - a report can only be filed against something that exists, by someone who is
 *   not the owner of it, and only once per live report;
 * - a dispute is as private as the booking behind it - a third party cannot even
 *   confirm that somebody else's dispute exists;
 * - opening a dispute **suspends** the booking rather than rewriting it, and
 *   closing it puts the booking back exactly where it was.
 */
describe('Reports and disputes (e2e)', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>();
  const auditLog: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];

  const reports = new Map<string, Record<string, unknown>>();
  const disputes = new Map<string, Record<string, unknown>>();
  const disputeEvents: Array<Record<string, unknown>> = [];
  const statusHistory: Array<Record<string, unknown>> = [];
  /** Backing rows for the two bookings under test. */
  const bookings = new Map<string, Record<string, unknown>>();

  let nextReportId = 0;
  let nextEventId = 0;

  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    report: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    dispute: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    disputeEvent: { create: jest.fn(), findMany: jest.fn() },
    booking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      // Present because the dispute service now *claims* the booking with a status
      // guard rather than writing it unguarded, and a test has to be able to make
      // that claim fail.
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    bookingStatusHistory: { create: jest.fn(), findMany: jest.fn() },
    service: { findUnique: jest.fn(), findMany: jest.fn() },
    review: { findUnique: jest.fn(), findMany: jest.fn() },
    professionalProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    serviceCategory: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
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

  /**
   * Session keys are role names plus `OTHER_CUSTOMER`, because this suite needs
   * two customers and a role name cannot hold both.
   */
  const as = (session: Role | 'OTHER_CUSTOMER') => ({
    Authorization: `Bearer ${tokens.get(session)}`,
  });
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    await loginAs({
      id: CUSTOMER_ID,
      phone: '+919800000002',
      fullName: 'Rahul Verma',
      role: 'CUSTOMER',
    });
    await loginAs(
      {
        id: OTHER_CUSTOMER_ID,
        phone: '+919800000009',
        fullName: 'Priya Nair',
        role: 'CUSTOMER',
      },
      // Both parties here are customers, so the second one has to be remembered
      // under its own key or it would overwrite the first one's session.
      { rememberAs: 'OTHER_CUSTOMER' },
    );
    await loginAs({
      id: PROFESSIONAL_USER_ID,
      phone: '+919800000003',
      fullName: 'Meera Iyer',
      role: 'PROFESSIONAL',
    });
    await loginAs({ id: ADMIN_ID, phone: '+919800000001', fullName: 'Aditi Rao', role: 'ADMIN' });
  }, 20_000);

  beforeEach(() => {
    reports.clear();
    disputes.clear();
    bookings.clear();
    auditLog.length = 0;
    notifications.length = 0;
    disputeEvents.length = 0;
    statusHistory.length = 0;
    nextReportId = 0;
    nextEventId = 0;
    jest.clearAllMocks();

    bookings.set(BOOKING_ID, {
      id: BOOKING_ID,
      reference: 'HZ-1001',
      status: 'COMPLETED_BY_PROFESSIONAL',
      customerId: CUSTOMER_ID,
      // Both parties are named on the row: the reporting and dispute services
      // resolve a report about a booking to the professional behind it.
      customer: { fullName: 'Rahul Verma' },
      professional: { userId: PROFESSIONAL_USER_ID, user: { fullName: 'Meera Iyer' } },
    });
    bookings.set(OTHER_BOOKING_ID, {
      id: OTHER_BOOKING_ID,
      reference: 'HZ-1002',
      status: 'IN_PROGRESS',
      customerId: OTHER_CUSTOMER_ID,
      customer: { fullName: 'Priya Nair' },
      professional: { userId: PROFESSIONAL_USER_ID, user: { fullName: 'Meera Iyer' } },
    });

    prisma.booking.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(bookings.get(where?.id) ?? null),
    );
    prisma.booking.update.mockImplementation(({ where, data }) => {
      const existing = bookings.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      bookings.set(where.id, updated);
      return Promise.resolve(updated);
    });
    /*
     * The guarded counterpart: a status the booking no longer holds matches nothing,
     * so a booking that changed between the read and the transaction is not silently
     * overwritten. A test needs this to be able to say so.
     */
    prisma.booking.updateMany.mockImplementation(({ where, data }) => {
      const existing = bookings.get(where?.id);
      if (!existing) return Promise.resolve({ count: 0 });
      if (where.status && existing.status !== where.status) {
        return Promise.resolve({ count: 0 });
      }
      bookings.set(where.id, { ...existing, ...data });
      return Promise.resolve({ count: 1 });
    });
    // Batched target labels: the admin list resolves a page in one query per type.
    prisma.booking.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        (where?.id?.in ?? []).flatMap((id: string) => {
          const found = bookings.get(id);
          return found ? [{ id: found.id, reference: found.reference }] : [];
        }),
      ),
    );
    prisma.service.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        (where?.id?.in ?? []).flatMap((id: string) =>
          id === SERVICE_ID ? [{ id: SERVICE_ID, title: 'Deep Clean' }] : [],
        ),
      ),
    );
    prisma.review.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        (where?.id?.in ?? []).flatMap((id: string) =>
          id === REVIEW_ID ? [{ id: REVIEW_ID, rating: 2 }] : [],
        ),
      ),
    );

    prisma.bookingStatusHistory.create.mockImplementation(({ data }) => {
      statusHistory.push(data);
      return Promise.resolve(data);
    });

    // The three reportable things that exist in this fixture.
    prisma.professionalProfile.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.userId === PROFESSIONAL_USER_ID
          ? { userId: PROFESSIONAL_USER_ID, user: { fullName: 'Meera Iyer' } }
          : null,
      ),
    );
    prisma.service.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.id === SERVICE_ID
          ? {
              title: 'Deep Clean',
              ownerId: PROFESSIONAL_USER_ID,
              owner: { fullName: 'Meera Iyer' },
            }
          : null,
      ),
    );
    prisma.review.findUnique.mockResolvedValue({
      customerId: OTHER_CUSTOMER_ID,
      customer: { fullName: 'Priya Nair' },
    });

    prisma.report.create.mockImplementation(({ data }) => {
      const created = {
        id: nextReportId === 0 ? REPORT_ID : `${REPORT_ID}-${nextReportId}`,
        status: 'OPEN',
        resolutionNote: null,
        resolutionAction: null,
        resolvedById: null,
        resolvedAt: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        ...data,
      };
      nextReportId += 1;
      reports.set(created.id, created);
      return Promise.resolve(created);
    });
    prisma.report.findUnique.mockImplementation(({ where }) => {
      const found = reports.get(where?.id);
      if (!found) return Promise.resolve(null);
      return Promise.resolve({
        ...found,
        reporter: { id: String(found.reporterId), fullName: 'Rahul Verma' },
        targetOwner: { id: String(found.targetOwnerId), fullName: 'Meera Iyer' },
      });
    });
    prisma.report.findFirst.mockImplementation(({ where }) => {
      const live = [...reports.values()].find(
        (report) =>
          report.reporterId === where?.reporterId &&
          report.targetType === where?.targetType &&
          report.targetId === where?.targetId &&
          !['RESOLVED', 'DISMISSED'].includes(String(report.status)),
      );
      return Promise.resolve(live ? { id: live.id } : null);
    });
    prisma.report.findMany.mockImplementation(({ where }) => {
      let result = [...reports.values()];
      if (where?.status) result = result.filter((report) => report.status === where.status);
      if (where?.reason) result = result.filter((report) => report.reason === where.reason);
      return Promise.resolve(
        result.map((report) => ({
          ...report,
          reporter: { id: String(report.reporterId), fullName: 'Rahul Verma' },
          targetOwner: { id: String(report.targetOwnerId), fullName: 'Meera Iyer' },
        })),
      );
    });
    prisma.report.update.mockImplementation(({ where, data }) => {
      const existing = reports.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      reports.set(where.id, updated);
      return Promise.resolve(updated);
    });

    prisma.dispute.create.mockImplementation(({ data }) => {
      const created = {
        id: DISPUTE_ID,
        resolutionNote: null,
        resolvedById: null,
        resolvedAt: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        ...data,
      };
      disputes.set(created.id, created);
      return Promise.resolve(created);
    });
    prisma.dispute.findUnique.mockImplementation(({ where }) => {
      const found = disputes.get(where?.id);
      if (!found) return Promise.resolve(null);
      return Promise.resolve({
        ...found,
        booking: {
          reference: bookings.get(String(found.bookingId))?.reference ?? 'HZ-1001',
          status: bookings.get(String(found.bookingId))?.status ?? 'DISPUTED',
        },
        openedBy: { id: String(found.openedById), fullName: 'Rahul Verma' },
        against: { id: String(found.againstId), fullName: 'Meera Iyer' },
        events: disputeEvents
          .filter((event) => event.disputeId === found.id)
          .map((event) => ({
            ...event,
            actor: { id: String(event.actorId), fullName: 'Rahul Verma', role: 'CUSTOMER' },
          })),
      });
    });
    prisma.dispute.findFirst.mockImplementation(({ where }) => {
      const live = [...disputes.values()].find(
        (dispute) =>
          dispute.bookingId === where?.bookingId &&
          !['RESOLVED', 'REJECTED'].includes(String(dispute.status)),
      );
      return Promise.resolve(live ? { id: live.id } : null);
    });
    prisma.dispute.findMany.mockImplementation(({ where }) => {
      let result = [...disputes.values()];
      if (where?.status) result = result.filter((dispute) => dispute.status === where.status);
      return Promise.resolve(
        result.map((dispute) => ({
          ...dispute,
          booking: {
            reference: bookings.get(String(dispute.bookingId))?.reference ?? 'HZ-1001',
            status: bookings.get(String(dispute.bookingId))?.status ?? 'DISPUTED',
          },
          openedBy: { id: String(dispute.openedById), fullName: 'Rahul Verma' },
          against: { id: String(dispute.againstId), fullName: 'Meera Iyer' },
        })),
      );
    });
    prisma.dispute.update.mockImplementation(({ where, data }) => {
      const existing = disputes.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      disputes.set(where.id, updated);
      return Promise.resolve(updated);
    });
    prisma.disputeEvent.create.mockImplementation(({ data }) => {
      const created = { id: `event-${nextEventId}`, createdAt: new Date(), ...data };
      nextEventId += 1;
      disputeEvents.push(created);
      return Promise.resolve(created);
    });

    prisma.notification.create.mockImplementation(({ data }) => {
      notifications.push(data);
      return Promise.resolve(data);
    });
    prisma.auditLog.create.mockImplementation(({ data }) => {
      auditLog.push(data);
      return Promise.resolve(data);
    });
  });

  /* ------------------------------------------------------------- reporting */

  describe('filing a report', () => {
    const validBody = {
      targetType: 'SERVICE',
      targetId: SERVICE_ID,
      reason: 'MISLEADING_LISTING',
      description: 'The listing promises a two-hour visit but the description says one hour.',
    };

    it('refuses an anonymous reporter', async () => {
      await api().post('/api/v1/reports').send(validBody).expect(401);
    });

    it('files a report about a listing and names its owner', async () => {
      const response = await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send(validBody)
        .expect(201);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          status: 'OPEN',
          reason: 'MISLEADING_LISTING',
          targetOwner: { id: PROFESSIONAL_USER_ID, fullName: 'Meera Iyer' },
          targetLabel: 'Listing: Deep Clean',
        }),
      );
    });

    it('tells the person reported, but never the reporter', async () => {
      await api().post('/api/v1/reports').set(as('CUSTOMER')).send(validBody).expect(201);

      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: PROFESSIONAL_USER_ID,
            type: 'REPORT_FILED_ABOUT_YOU',
          }),
        ]),
      );
      expect(notifications.some((n) => n.userId === CUSTOMER_ID)).toBe(false);
    });

    it('accepts a report about a professional, a booking and a review', async () => {
      for (const [targetType, targetId] of [
        ['PROFESSIONAL', PROFESSIONAL_USER_ID],
        ['BOOKING', BOOKING_ID],
        ['REVIEW', 'd9000000-0000-4000-8000-000000000001'],
      ]) {
        await api()
          .post('/api/v1/reports')
          .set(as('CUSTOMER'))
          .send({ ...validBody, targetType, targetId })
          .expect(201);
      }
    });

    it('refuses a target that does not exist', async () => {
      await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({
          ...validBody,
          targetId: '99999999-0000-4000-8000-000000000099',
        })
        .expect(404);
    });

    it('names the other party when the customer reports one of their bookings', async () => {
      const response = await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({ ...validBody, targetType: 'BOOKING', targetId: BOOKING_ID })
        .expect(201);

      // The person being reported is whoever the reporter is not. Naming the
      // professional unconditionally would report the customer about themselves the
      // moment the customer is the one filing.
      expect(response.body.data.targetOwner.id).toBe(PROFESSIONAL_USER_ID);
    });

    it('names the customer when the professional reports one of their bookings', async () => {
      const response = await api()
        .post('/api/v1/reports')
        .set(as('PROFESSIONAL'))
        .send({ ...validBody, targetType: 'BOOKING', targetId: BOOKING_ID })
        .expect(201);

      expect(response.body.data.targetOwner.id).toBe(CUSTOMER_ID);
    });

    it('refuses a report about a booking the reporter has no part in', async () => {
      /*
       * A booking is not public: only its two parties may complain about it. Any
       * signed-in user could otherwise file against a stranger's booking, which tells
       * that stranger's professional they have been reported and discloses the
       * booking reference through the target label.
       *
       * Reported as *not found* rather than forbidden on purpose: confirming the
       * booking exists would leak the very thing the check protects.
       */
      const response = await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({ ...validBody, targetType: 'BOOKING', targetId: OTHER_BOOKING_ID });

      expect(response.status).toBe(404);
      expect(reports.size).toBe(0);
      expect(notifications).toHaveLength(0);
    });

    it('refuses a report about yourself', async () => {
      await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({
          ...validBody,
          targetType: 'SERVICE',
          targetId: SERVICE_ID,
        })
        .expect(201);

      // The professional owns the listing in this fixture, so a professional
      // filing about it is reporting themselves.
      await api().post('/api/v1/reports').set(as('PROFESSIONAL')).send(validBody).expect(400);
    });

    it('refuses a second live report about the same thing', async () => {
      await api().post('/api/v1/reports').set(as('CUSTOMER')).send(validBody).expect(201);

      const second = await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send(validBody)
        .expect(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });

    it('requires a real description', async () => {
      await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({ ...validBody, description: 'bad' })
        .expect(400);
    });

    it('rejects an unknown reason', async () => {
      await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({ ...validBody, reason: 'BECAUSE_I_SAID_SO' })
        .expect(400);
    });
  });

  describe('admin triage', () => {
    const seed = async () => {
      await api()
        .post('/api/v1/reports')
        .set(as('CUSTOMER'))
        .send({
          targetType: 'SERVICE',
          targetId: SERVICE_ID,
          reason: 'MISLEADING_LISTING',
          description: 'The listing promises a two-hour visit but says one hour.',
        })
        .expect(201);
    };

    it('refuses non-admins', async () => {
      await api().get('/api/v1/admin/reports').expect(401);
      await api().get('/api/v1/admin/reports').set(as('CUSTOMER')).expect(403);
      await api().get('/api/v1/admin/reports').set(as('PROFESSIONAL')).expect(403);
    });

    it('lists reports with the target label resolved', async () => {
      await seed();
      const response = await api().get('/api/v1/admin/reports').set(as('ADMIN')).expect(200);

      expect(response.body.data[0]).toEqual(
        expect.objectContaining({
          status: 'OPEN',
          targetLabel: 'Listing: Deep Clean',
          reporter: expect.objectContaining({ id: CUSTOMER_ID }),
        }),
      );
    });

    it('can be claimed for review without deciding it', async () => {
      await seed();
      const response = await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/review`)
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data.status).toBe('UNDER_REVIEW');
    });

    it('closes a report with a note the reporter is told', async () => {
      await seed();
      const response = await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({
          status: 'RESOLVED',
          resolutionNote: 'The listing was withdrawn and the professional has corrected it.',
          resolutionAction: 'LISTING_WITHDRAWN',
        })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          status: 'RESOLVED',
          resolutionAction: 'LISTING_WITHDRAWN',
        }),
      );
      expect(notifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: CUSTOMER_ID, type: 'SYSTEM' })]),
      );
    });

    it('records the decision in the audit log', async () => {
      await seed();
      await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'DISMISSED', resolutionNote: 'The listing matched what was promised.' })
        .expect(200);

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'REPORT_RESOLVED',
            entityType: 'REPORT',
          }),
        ]),
      );
    });

    it('requires a note when closing', async () => {
      await seed();
      await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'DISMISSED', resolutionNote: 'no' })
        .expect(400);
    });

    it('refuses to close the same report twice', async () => {
      await seed();
      await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'The listing was withdrawn and corrected.' })
        .expect(200);

      await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'DISMISSED', resolutionNote: 'Actually nothing was wrong here.' })
        .expect(400);
    });

    it('allows a fresh report about the same target once the first is closed', async () => {
      const body = {
        targetType: 'SERVICE',
        targetId: SERVICE_ID,
        reason: 'MISLEADING_LISTING',
        description: 'The listing promises a two-hour visit but says one hour.',
      };
      await api().post('/api/v1/reports').set(as('CUSTOMER')).send(body).expect(201);
      await api()
        .patch(`/api/v1/admin/reports/${REPORT_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'The listing was withdrawn and corrected.' })
        .expect(200);

      await api().post('/api/v1/reports').set(as('CUSTOMER')).send(body).expect(201);
    });
  });

  /* -------------------------------------------------------------- disputes */

  describe('opening a dispute', () => {
    const body = {
      category: 'SERVICE_NOT_AS_DESCRIBED',
      reason: 'The deep clean took forty minutes and three areas were not touched at all.',
    };

    it('refuses a third party, so the endpoint cannot confirm a booking exists', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('OTHER_CUSTOMER'))
        .send(body)
        .expect(404);
    });

    it('refuses an anonymous caller', async () => {
      await api().post(`/api/v1/bookings/${BOOKING_ID}/dispute`).send(body).expect(401);
    });

    it('lets the customer open one and suspends the booking', async () => {
      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      const data = response.body.data;
      expect(data.status).toBe('OPEN');
      expect(data.category).toBe('SERVICE_NOT_AS_DESCRIBED');
      expect(data.bookingStatus).toBe('DISPUTED');
      expect(data.against.id).toBe(PROFESSIONAL_USER_ID);
      expect(bookings.get(BOOKING_ID)!.status).toBe('DISPUTED');
    });

    it('records the booking status it interrupted so it can be restored', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      expect(disputes.get(DISPUTE_ID)!.bookingStatusBeforeDispute).toBe(
        'COMPLETED_BY_PROFESSIONAL',
      );
      expect(statusHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bookingId: BOOKING_ID,
            fromStatus: 'COMPLETED_BY_PROFESSIONAL',
            toStatus: 'DISPUTED',
          }),
        ]),
      );
    });

    it('refuses to open one on a booking that changed since it was read', async () => {
      /*
       * The booking is claimed with a status guard rather than written unguarded.
       * A booking cancelled between the read and the transaction would otherwise be
       * resurrected into `DISPUTED`, and because the restore later skips a terminal
       * status it could never be put back - stranded in a state neither party nor an
       * admin can leave.
       *
       * The double reports the guard as matching nothing, which is that race.
       */
      prisma.booking.updateMany.mockResolvedValueOnce({ count: 0 });

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body);

      expect(response.status).toBe(409);
      // The booking keeps the status it actually had, and no dispute was opened.
      expect(bookings.get(BOOKING_ID)!.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(disputes.size).toBe(0);
    });

    it('records the opening post in the dispute history', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      expect(disputeEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'OPENED', body: body.reason })]),
      );
    });

    it('tells the counterparty', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      expect(notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: PROFESSIONAL_USER_ID,
            type: 'DISPUTE_OPENED',
          }),
        ]),
      );
    });

    it('lets the professional open one against the customer', async () => {
      const response = await api()
        .post(`/api/v1/bookings/${OTHER_BOOKING_ID}/dispute`)
        .set(as('PROFESSIONAL'))
        .send({
          category: 'UNSAFE_BEHAVIOUR',
          reason: 'Nobody was home and the address was unsafe.',
        })
        .expect(201);

      expect(response.body.data.against.id).toBe(OTHER_CUSTOMER_ID);
    });

    it('refuses a second dispute on the same booking', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(409);
    });

    it('refuses to dispute a booking already in dispute', async () => {
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'DISPUTED' });

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(409);
    });

    it('refuses a closed booking', async () => {
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'CANCELLED' });

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(400);
    });

    it('refuses a booking the customer closed after paying for it', async () => {
      // Closing is the customer's own final step. Once it is taken the record is
      // history, so there is nothing left to suspend.
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'CLOSED' });

      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(400);
      expect(disputes.size).toBe(0);
    });

    it('lets a customer dispute a paid booking', async () => {
      /*
       * The money moved but the job was not what was agreed. Refusing this because
       * the payment settled is backwards: the settlement is exactly why the customer
       * has something to complain about, and blocking it left a customer who had
       * already paid with no route to ask for a remedy.
       */
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'PAID' });

      const response = await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);

      expect(response.body.data.status).toBe('OPEN');
      expect(response.body.data.bookingStatus).toBe('DISPUTED');
      expect(bookings.get(BOOKING_ID)!.status).toBe('DISPUTED');
      // Recorded so the booking resumes as paid rather than dropping out of the
      // payment lifecycle it had already reached.
      expect(disputes.get(DISPUTE_ID)!.bookingStatusBeforeDispute).toBe('PAID');
      expect(statusHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bookingId: BOOKING_ID,
            fromStatus: 'PAID',
            toStatus: 'DISPUTED',
          }),
        ]),
      );
    });

    it('lets the professional dispute a paid booking too', async () => {
      bookings.set(OTHER_BOOKING_ID, { ...bookings.get(OTHER_BOOKING_ID)!, status: 'PAID' });

      const response = await api()
        .post(`/api/v1/bookings/${OTHER_BOOKING_ID}/dispute`)
        .set(as('PROFESSIONAL'))
        .send({ category: 'PAYMENT_ISSUE', reason: 'The transfer came in short by half.' })
        .expect(201);

      expect(response.body.data.bookingStatus).toBe('DISPUTED');
      expect(response.body.data.against.id).toBe(OTHER_CUSTOMER_ID);
    });

    it('requires a real account of what happened', async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send({ category: 'QUALITY_ISSUE', reason: 'bad' })
        .expect(400);
    });
  });

  describe('dispute conversation', () => {
    const body = {
      category: 'SERVICE_NOT_AS_DESCRIBED',
      reason: 'The deep clean took forty minutes and three areas were not touched at all.',
    };

    const openOne = async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);
    };

    it('lets the counterparty answer', async () => {
      await openOne();

      const response = await api()
        .post(`/api/v1/disputes/${DISPUTE_ID}/messages`)
        .set(as('PROFESSIONAL'))
        .send({ body: 'I was there for the full hour; here is what happened.' })
        .expect(201);

      expect(response.body.data.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'MESSAGE' })]),
      );
    });

    it('keeps a stranger out of the conversation', async () => {
      await openOne();

      await api()
        .post(`/api/v1/disputes/${DISPUTE_ID}/messages`)
        .set(as('OTHER_CUSTOMER'))
        .send({ body: 'Let me in.' })
        .expect(404);
    });

    it('refuses a message with no body', async () => {
      await openOne();

      await api()
        .post(`/api/v1/disputes/${DISPUTE_ID}/messages`)
        .set(as('PROFESSIONAL'))
        .send({ body: '   ' })
        .expect(400);
    });

    it('shows the dispute to a party on request', async () => {
      await openOne();

      await api().get(`/api/v1/bookings/${BOOKING_ID}/dispute`).set(as('PROFESSIONAL')).expect(200);
    });

    it('hides the dispute from a stranger', async () => {
      await openOne();

      await api()
        .get(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('OTHER_CUSTOMER'))
        .expect(404);
    });
  });

  describe('admin adjudication', () => {
    const body = {
      category: 'SERVICE_NOT_AS_DESCRIBED',
      reason: 'The deep clean took forty minutes and three areas were not touched at all.',
    };

    const openOne = async () => {
      await api()
        .post(`/api/v1/bookings/${BOOKING_ID}/dispute`)
        .set(as('CUSTOMER'))
        .send(body)
        .expect(201);
    };

    it('refuses non-admins', async () => {
      await api().get('/api/v1/admin/disputes').expect(401);
      await api().get('/api/v1/admin/disputes').set(as('CUSTOMER')).expect(403);
    });

    it('lists disputes', async () => {
      await openOne();
      const response = await api().get('/api/v1/admin/disputes').set(as('ADMIN')).expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bookingReference: 'HZ-1001',
            status: 'OPEN',
            bookingStatus: 'DISPUTED',
          }),
        ]),
      );
    });

    it('reads the full history', async () => {
      await openOne();
      await api()
        .post(`/api/v1/disputes/${DISPUTE_ID}/messages`)
        .set(as('PROFESSIONAL'))
        .send({ body: 'Here is my side of it.' })
        .expect(201);

      const response = await api()
        .get(`/api/v1/admin/disputes/${DISPUTE_ID}`)
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data.events.map((e: { type: string }) => e.type)).toEqual([
        'OPENED',
        'MESSAGE',
      ]);
    });

    it('can be claimed for review', async () => {
      await openOne();
      const response = await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/review`)
        .set(as('ADMIN'))
        .expect(200);

      expect(response.body.data.status).toBe('UNDER_REVIEW');
      expect(bookings.get(BOOKING_ID)!.status).toBe('DISPUTED');
    });

    it('resolves the dispute and puts the booking back where it was', async () => {
      await openOne();

      const response = await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({
          status: 'RESOLVED',
          resolutionNote: 'Partial refund of 25 percent agreed between both parties.',
        })
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ status: 'RESOLVED', bookingStatus: 'COMPLETED_BY_PROFESSIONAL' }),
      );
      expect(bookings.get(BOOKING_ID)!.status).toBe('COMPLETED_BY_PROFESSIONAL');
      expect(statusHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStatus: 'DISPUTED',
            toStatus: 'COMPLETED_BY_PROFESSIONAL',
          }),
        ]),
      );
    });

    it('lifts the suspension even when the dispute is rejected', async () => {
      await openOne();

      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'REJECTED', resolutionNote: 'The work was carried out as described.' })
        .expect(200);

      expect(bookings.get(BOOKING_ID)!.status).toBe('COMPLETED_BY_PROFESSIONAL');
    });

    it('puts a paid booking back to paid when the dispute closes', async () => {
      /*
       * Suspending a paid booking must not demote it. Restoring it anywhere other
       * than `PAID` would drop a booking that had settled back into an earlier stage
       * of the lifecycle, with a payment recorded as paid against a job that had
       * apparently not happened.
       */
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'PAID' });
      await openOne();
      expect(bookings.get(BOOKING_ID)!.status).toBe('DISPUTED');

      const response = await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'The work was redone on 12 March.' })
        .expect(200);

      expect(response.body.data.bookingStatus).toBe('PAID');
      expect(bookings.get(BOOKING_ID)!.status).toBe('PAID');
      expect(statusHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bookingId: BOOKING_ID,
            fromStatus: 'DISPUTED',
            toStatus: 'PAID',
          }),
        ]),
      );
    });

    it('puts a paid booking back to paid even when the dispute is rejected', async () => {
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'PAID' });
      await openOne();

      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'REJECTED', resolutionNote: 'The work was carried out as agreed.' })
        .expect(200);

      // What the platform concluded about the dispute says nothing about where the
      // booking goes next: either way the suspension is lifted to where it was.
      expect(bookings.get(BOOKING_ID)!.status).toBe('PAID');
    });

    it('tells both parties the outcome', async () => {
      await openOne();
      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'Partial refund agreed by both parties.' })
        .expect(200);

      const recipients = notifications
        .filter((n) => n.type === 'DISPUTE_RESOLVED')
        .map((n) => n.userId);
      expect(recipients).toEqual(expect.arrayContaining([CUSTOMER_ID, PROFESSIONAL_USER_ID]));
    });

    it('records the outcome in the audit log', async () => {
      await openOne();
      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'Partial refund agreed by both parties.' })
        .expect(200);

      expect(auditLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorUserId: ADMIN_ID,
            action: 'DISPUTE_STATUS_CHANGED',
            entityType: 'DISPUTE',
            metadata: expect.objectContaining({
              restoredBookingStatus: 'COMPLETED_BY_PROFESSIONAL',
            }),
          }),
        ]),
      );
    });

    it('refuses to resolve the same dispute twice', async () => {
      await openOne();
      const note = 'Partial refund agreed by both parties, nothing further due.';

      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: note })
        .expect(200);
      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'REJECTED', resolutionNote: note })
        .expect(400);
    });

    it('will not reopen a booking that was closed while the dispute ran', async () => {
      await openOne();
      // The booking was cancelled outright after the dispute was raised.
      bookings.set(BOOKING_ID, { ...bookings.get(BOOKING_ID)!, status: 'CANCELLED' });

      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'The booking was already cancelled by both.' })
        .expect(200);

      // Closing the dispute must not drag the booking back to an earlier stage.
      expect(bookings.get(BOOKING_ID)!.status).toBe('CANCELLED');
    });

    it('refuses new messages after closing', async () => {
      await openOne();
      await api()
        .patch(`/api/v1/admin/disputes/${DISPUTE_ID}/resolve`)
        .set(as('ADMIN'))
        .send({ status: 'RESOLVED', resolutionNote: 'Partial refund agreed by both parties.' })
        .expect(200);

      await api()
        .post(`/api/v1/disputes/${DISPUTE_ID}/messages`)
        .set(as('PROFESSIONAL'))
        .send({ body: 'One more thing.' })
        .expect(400);
    });
  });
});

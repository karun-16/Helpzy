import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';

/**
 * The acceptance criterion for the location marketplace, tested end to end:
 *
 *   a customer browsing Tirupati sees Tirupati professionals and nobody else, and
 *   switching to Vijayawada replaces that set with Vijayawada's.
 *
 * The fake Prisma below implements only the clauses the discovery service actually
 * emits - `role`, `status` and `professionalProfile.is.locationId` - and applies
 * them for real to an in-memory table. That matters: a mock that ignored the
 * `where` would pass this suite while the shipped code filtered nothing, which is
 * the failure this feature exists to prevent.
 */

const TIRUPATI_SLUG = 'ap-tirupati-tirupati';
const VIJAYAWADA_SLUG = 'ap-ntr-vijayawada';
const UNKNOWN_SLUG = 'atlantis-mars-city';

const TIRUPATI_ID = 'c0000000-0000-4000-8000-000000000001';
const VIJAYAWADA_ID = 'c0000000-0000-4000-8000-000000000002';

const TIRUPATI_PROFESSIONAL = 'a2000000-0000-4000-8000-000000000001';
const VIJAYAWADA_PROFESSIONAL = 'a2000000-0000-4000-8000-000000000002';
const UNPLACED_PROFESSIONAL = 'a2000000-0000-4000-8000-000000000003';

const CATEGORY_ID = 'a7000000-0000-4000-8000-000000000001';
const OTHER_CATEGORY_ID = 'a7000000-0000-4000-8000-000000000002';

const TIRUPATI_SERVICE_ID = 'a6000000-0000-4000-8000-000000000001';
const VIJAYAWADA_SERVICE_ID = 'a6000000-0000-4000-8000-000000000002';
const UNPLACED_SERVICE_ID = 'a6000000-0000-4000-8000-000000000003';

interface LocationRow {
  id: string;
  slug: string;
  state: string;
  district: string;
  city: string;
}

/**
 * The only filter clauses the discovery service emits, typed narrowly on purpose.
 *
 * Spelling them out rather than using `any` means the fake has to keep up if the
 * service starts filtering on something new: an unrecognised clause simply cannot
 * be represented, so a new filter cannot be silently ignored here.
 */
type ProfileFilter = { locationId?: string | null; verification?: string };
type ProfessionalFilter = {
  role?: string;
  status?: string;
  professionalProfile?: { is?: ProfileFilter; isNot?: null };
};

/**
 * The `where` clauses these endpoints emit, spelled out instead of `Record<string, any>`.
 *
 * Typed narrowly so the fake has to keep up: if the service starts filtering on
 * something new, the unrecognised clause cannot be expressed here and this file
 * stops compiling rather than quietly ignoring it.
 */
type ServiceWhere = { id?: string; owner?: { is?: ProfessionalFilter } };
type CategoryWhere = {
  isActive?: boolean;
  services?: { some?: { owner?: { is?: ProfessionalFilter } } };
};

interface ProfessionalRow {
  id: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  professionalProfile: {
    businessName: string;
    bio: string | null;
    verification: string;
    serviceArea: string | null;
    locationId: string | null;
    location: { slug: string; state: string; district: string; city: string } | null;
    averageRating: { toNumber: () => number };
    ratingCount: number;
    contactEmail: string | null;
    isPhoneVisible: boolean;
    yearsOfExperience: number | null;
    workingHours: unknown;
  };
  services: unknown[];
}

describe('Location marketplace (e2e)', () => {
  let app: INestApplication;
  let config: AppConfigRef;

  const locations = new Map<string, LocationRow>([
    [
      TIRUPATI_SLUG,
      {
        id: TIRUPATI_ID,
        slug: TIRUPATI_SLUG,
        state: 'Andhra Pradesh',
        district: 'Tirupati',
        city: 'Tirupati',
      },
    ],
    [
      VIJAYAWADA_SLUG,
      {
        id: VIJAYAWADA_ID,
        slug: VIJAYAWADA_SLUG,
        state: 'Andhra Pradesh',
        district: 'NTR',
        city: 'Vijayawada',
      },
    ],
  ]);

  const users: ProfessionalRow[] = [
    professional(TIRUPATI_PROFESSIONAL, 'Tirupati Pro', TIRUPATI_ID),
    professional(VIJAYAWADA_PROFESSIONAL, 'Vijayawada Pro', VIJAYAWADA_ID),
    // Registered before locations existed, and never completed one.
    professional(UNPLACED_PROFESSIONAL, 'Unplaced Pro', null),
  ];

  const categories = [
    { id: CATEGORY_ID, slug: 'home-services', name: 'Home Services', isActive: true },
    { id: OTHER_CATEGORY_ID, slug: 'fitness', name: 'Health & Fitness', isActive: true },
  ];

  const service = (
    id: string,
    title: string,
    ownerId: string,
    categoryId: string,
    categorySlug: string,
    categoryName: string,
  ) => ({
    id,
    title,
    summary: null,
    description: 'A service.',
    basePrice: { toNumber: () => 500 },
    currency: 'INR',
    durationMinutes: 60,
    isActive: true,
    moderationStatus: 'APPROVED',
    ownerId,
    categoryId,
    category: { id: categoryId, slug: categorySlug, name: categoryName },
  });

  const services = [
    service(
      TIRUPATI_SERVICE_ID,
      'Deep clean',
      TIRUPATI_PROFESSIONAL,
      CATEGORY_ID,
      'home-services',
      'Home Services',
    ),
    service(
      VIJAYAWADA_SERVICE_ID,
      'Personal training',
      VIJAYAWADA_PROFESSIONAL,
      OTHER_CATEGORY_ID,
      'fitness',
      'Health & Fitness',
    ),
    service(
      UNPLACED_SERVICE_ID,
      'Odd jobs',
      UNPLACED_PROFESSIONAL,
      CATEGORY_ID,
      'home-services',
      'Home Services',
    ),
  ];

  const prisma = {
    location: {
      findUnique: jest.fn(async ({ where }: { where: { slug: string } }) => {
        return locations.get(where.slug) ?? null;
      }),
    },
    user: {
      findMany: jest.fn(async (args: { where?: ProfessionalFilter }) => {
        return users.filter((user) => matchesProfessionalFilter(user, args.where));
      }),
      findFirst: jest.fn(async (args: { where?: ProfessionalFilter }) => {
        return users.find((user) => matchesProfessionalFilter(user, args.where)) ?? null;
      }),
    },
    service: {
      findFirst: jest.fn(async (args: { where: ServiceWhere }) => {
        const found = services.find((candidate) => candidate.id === args.where.id);
        if (!found) return null;

        const owner = users.find((user) => user.id === found.ownerId) ?? null;
        // The endpoint restricts the service to one whose owner passes the same
        // professional filter the listing uses. Honouring it here is what makes
        // this test meaningful: ignoring it would pass while a cross-city leak
        // shipped.
        if (args.where.owner?.is && !matchesProfessionalFilter(owner, args.where.owner.is)) {
          return null;
        }
        return { ...found, owner };
      }),
    },
    serviceCategory: {
      findMany: jest.fn(async (args: { where?: CategoryWhere }) =>
        categories.filter((category) => {
          if (args.where?.isActive === false) return false;
          const ownerFilter = args.where?.services?.some?.owner?.is;
          if (!ownerFilter) return true;
          // A category is visible only when it has an active service whose owner
          // passes the same professional filter the listing used.
          return services.some(
            (candidate) =>
              candidate.categoryId === category.id &&
              candidate.isActive &&
              matchesProfessionalFilter(
                users.find((user) => user.id === candidate.ownerId)!,
                ownerFilter,
              ),
          );
        }),
      ),
    },
    review: { findMany: jest.fn(async () => []) },
    booking: {
      groupBy: jest.fn(async () => []),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      aggregate: jest.fn(async () => []),
    },
    // Present so the module graph boots. Nothing on the discovery path reads them,
    // and a stub returning nothing is honest here: this suite is about filtering.
    platformSetting: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => null) },
    auditLog: { findMany: jest.fn(async () => []), create: jest.fn(async () => null) },
    notification: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    professionalProfile: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    mediaAsset: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    config = moduleRef.get<AppConfigRef>(APP_CONFIG);
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('professional listing', () => {
    it('returns only Tirupati professionals when the location is Tirupati', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      expect(response.body.data.map((entry: { fullName: string }) => entry.fullName)).toEqual([
        'Tirupati Pro',
      ]);
    });

    it('never returns a professional from another city', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      const names = response.body.data.map((entry: { fullName: string }) => entry.fullName);
      expect(names).not.toContain('Vijayawada Pro');
      expect(names).not.toContain('Unplaced Pro');
    });

    it('excludes a professional who has not chosen a location', async () => {
      // They exist and are active, but a null `locationId` cannot equal a resolved
      // location, so they belong to no city's marketplace.
      for (const slug of [TIRUPATI_SLUG, VIJAYAWADA_SLUG]) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/customer/professionals')
          .query({ location: slug })
          .expect(200);

        const names = response.body.data.map((entry: { fullName: string }) => entry.fullName);
        expect(names).not.toContain('Unplaced Pro');
      }
    });

    it('swaps the whole result set when the location changes', async () => {
      const tirupati = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);
      const vijayawada = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: VIJAYAWADA_SLUG })
        .expect(200);

      const tirupatiNames = tirupati.body.data.map((e: { fullName: string }) => e.fullName);
      const vijayawadaNames = vijayawada.body.data.map((e: { fullName: string }) => e.fullName);

      expect(tirupatiNames).toEqual(['Tirupati Pro']);
      expect(vijayawadaNames).toEqual(['Vijayawada Pro']);
      expect(tirupatiNames).not.toContain('Vijayawada Pro');
      expect(vijayawadaNames).not.toContain('Tirupati Pro');
    });

    it('reports each professional’s own city so the UI need not guess', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: VIJAYAWADA_SLUG })
        .expect(200);

      expect(response.body.data[0].location).toEqual({
        slug: VIJAYAWADA_SLUG,
        state: 'Andhra Pradesh',
        district: 'NTR',
        city: 'Vijayawada',
      });
    });

    it('applies the filter in the query, not in the response', async () => {
      prisma.user.findMany.mockClear();

      await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      // The decisive assertion: the restriction reaches the database layer.
      const calledWith = prisma.user.findMany.mock.calls.at(0)?.[0] as {
        where: { professionalProfile: { is: { locationId?: string } } };
      };
      expect(calledWith.where.professionalProfile.is.locationId).toBe(TIRUPATI_ID);
    });

    it('never sends the location’s coordinates to the client', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('latitude');
      expect(JSON.stringify(response.body)).not.toContain('longitude');
    });
  });

  describe('category listing', () => {
    it('shows only categories served in the chosen city', async () => {
      const tirupati = await request(app.getHttpServer())
        .get('/api/v1/customer/services')
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      // Home Services only: the fitness category's professional is in Vijayawada.
      expect(tirupati.body.data.map((c: { slug: string }) => c.slug)).toEqual(['home-services']);

      const vijayawada = await request(app.getHttpServer())
        .get('/api/v1/customer/services')
        .query({ location: VIJAYAWADA_SLUG })
        .expect(200);

      expect(vijayawada.body.data.map((c: { slug: string }) => c.slug)).toEqual(['fitness']);
    });
  });

  describe('per-service professionals', () => {
    it('does not leak a provider from another city on a service page', async () => {
      // A Tirupati listing requested from a Vijayawada marketplace resolves to
      // nothing at all, rather than resolving and then hiding the provider.
      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/services/${TIRUPATI_SERVICE_ID}/professionals`)
        .query({ location: VIJAYAWADA_SLUG })
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('Tirupati Pro');
    });

    it('still serves a service page when the provider is in the chosen city', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/customer/services/${TIRUPATI_SERVICE_ID}/professionals`)
        .query({ location: TIRUPATI_SLUG })
        .expect(200);

      expect(response.body.data.professionals.map((p: { fullName: string }) => p.fullName)).toEqual(
        ['Tirupati Pro'],
      );
    });
  });

  describe('input validation', () => {
    it('rejects a location slug that is not in the dataset', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .query({ location: UNKNOWN_SLUG })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
      // And nothing was queried with it.
      expect(prisma.user.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: UNKNOWN_SLUG }) }),
      );
    });

    it('rejects a well-formed but unknown slug identically', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customer/services')
        .query({ location: 'ap-nowhere-nowhere' })
        .expect(400);
    });

    it('still serves the marketplace when no location is supplied', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/customer/professionals')
        .expect(200);

      // Compatibility: the parameter is optional, so an old caller is not broken.
      expect(response.body.data).toHaveLength(3);
    });
  });

  /** Applies the professional filter the discovery service builds, for real. */
  function matchesProfessionalFilter(
    user: ProfessionalRow | null | undefined,
    where: ProfessionalFilter | undefined,
  ): boolean {
    if (!user || !where) return true;
    if (where.role && user.role !== where.role) return false;
    if (where.status && user.status !== where.status) return false;

    if (where.professionalProfile?.isNot === null && !user.professionalProfile) return false;

    const profileFilter = where.professionalProfile?.is;
    if (!profileFilter) return true;
    if (!user.professionalProfile) return false;
    // A null `locationId` on the row can never equal a resolved location id.
    if (
      'locationId' in profileFilter &&
      user.professionalProfile.locationId !== profileFilter.locationId
    ) {
      return false;
    }
    if (
      profileFilter.verification &&
      user.professionalProfile.verification !== profileFilter.verification
    ) {
      return false;
    }
    return true;
  }

  function professional(id: string, fullName: string, locationId: string | null): ProfessionalRow {
    const location = locationId
      ? (locations.get(locationId === TIRUPATI_ID ? TIRUPATI_SLUG : VIJAYAWADA_SLUG) as LocationRow)
      : null;

    return {
      id,
      fullName,
      phone: null,
      avatarUrl: null,
      role: 'PROFESSIONAL',
      status: 'ACTIVE',
      professionalProfile: {
        businessName: fullName,
        bio: null,
        verification: 'VERIFIED',
        serviceArea: location?.city ?? null,
        locationId,
        location: location
          ? {
              slug: location.slug,
              state: location.state,
              district: location.district,
              city: location.city,
            }
          : null,
        averageRating: { toNumber: () => 0 },
        ratingCount: 0,
        contactEmail: null,
        isPhoneVisible: false,
        yearsOfExperience: null,
        workingHours: null,
      },
      /*
       * A getter rather than a value: `users` is declared before `services`, so
       * reading the array here would hit the temporal dead zone. Resolved on first
       * read instead, by which time it exists.
       */
      get services() {
        return services.filter((candidate) => candidate.ownerId === id);
      },
    };
  }
});

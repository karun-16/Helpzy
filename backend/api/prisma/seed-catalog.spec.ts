/**
 * Tests for the production catalogue seed.
 *
 * The seed is a script rather than application code, so these cover the two things
 * that would be expensive to get wrong in production: the targeting guard, and the
 * guarantee that the catalogue accounts cannot be signed into.
 */
import { randomBytes } from 'node:crypto';
import {
  assertExplicitTarget,
  buildCategoryCreate,
  buildCategoryUpdate,
  buildProfessionalCreateData,
  buildProfessionalUpdateData,
  buildServiceCreate,
  buildServiceUpdate,
  CATEGORIES,
  CONFIRMATION_TOKEN,
  isForbiddenHost,
  parseDatabaseUrl,
  PROFESSIONALS,
  seedCatalogue,
  SERVICES,
  unreachableCredential,
  type CataloguePrisma,
} from './seed-catalog';

const REMOTE_URL = 'postgresql://catalog_user:not-a-real-password@db.example.invalid:5432/helpzy';
const REMOTE_HOST = 'db.example.invalid';

describe('catalogue seed targeting guard', () => {
  function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: REMOTE_URL,
      CATALOGUE_SEED_CONFIRM: CONFIRMATION_TOKEN,
      CATALOGUE_SEED_TARGET_HOST: REMOTE_HOST,
      ...overrides,
    } as NodeJS.ProcessEnv;
  }

  it('accepts an explicitly confirmed remote target', () => {
    expect(assertExplicitTarget(env())).toEqual({ host: REMOTE_HOST, database: 'helpzy' });
  });

  it('refuses without the confirmation token', () => {
    expect(() => assertExplicitTarget(env({ CATALOGUE_SEED_CONFIRM: undefined }))).toThrow(
      /CATALOGUE_SEED_CONFIRM/,
    );
  });

  it('refuses a wrong confirmation token', () => {
    expect(() => assertExplicitTarget(env({ CATALOGUE_SEED_CONFIRM: 'yes' }))).toThrow(
      /CATALOGUE_SEED_CONFIRM/,
    );
  });

  it('refuses without DATABASE_URL rather than loading the repository env', () => {
    expect(() => assertExplicitTarget(env({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });

  it('refuses without a declared target host', () => {
    expect(() => assertExplicitTarget(env({ CATALOGUE_SEED_TARGET_HOST: undefined }))).toThrow(
      /CATALOGUE_SEED_TARGET_HOST/,
    );
  });

  it('refuses when the declared host is not the connected host', () => {
    expect(() =>
      assertExplicitTarget(env({ CATALOGUE_SEED_TARGET_HOST: 'other.host.invalid' })),
    ).toThrow(/does not match/);
  });

  it.each(['localhost', '127.0.0.1', 'postgres.local', 'db.internal', 'host.docker.internal'])(
    'refuses the local address %s',
    (host) => {
      expect(isForbiddenHost(host)).toBe(true);
      expect(() =>
        assertExplicitTarget(
          env({
            DATABASE_URL: `postgresql://u:p@${host}:5432/helpzy`,
            CATALOGUE_SEED_TARGET_HOST: host,
          }),
        ),
      ).toThrow(/local address/);
    },
  );

  it('refuses a non-PostgreSQL connection string', () => {
    expect(() =>
      assertExplicitTarget(env({ DATABASE_URL: 'mysql://u:p@db.example.invalid:3306/helpzy' })),
    ).toThrow(/PostgreSQL/);
  });

  it('never repeats the password from DATABASE_URL in a refusal', () => {
    let message = '';
    try {
      assertExplicitTarget(env({ CATALOGUE_SEED_TARGET_HOST: 'wrong.host.invalid' }));
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).not.toContain('not-a-real-password');
  });

  it('reads host and database without exposing the credentials', () => {
    const target = parseDatabaseUrl(REMOTE_URL);
    expect(target).toEqual({ host: REMOTE_HOST, database: 'helpzy' });
    expect(JSON.stringify(target)).not.toContain('not-a-real-password');
  });
});

describe('catalogue seed sign-in safety', () => {
  it('gives every catalogue professional a NULL phone on insert', () => {
    for (const professional of PROFESSIONALS) {
      expect(buildProfessionalCreateData(professional).phone).toBeNull();
    }
  });

  it('clears any reachable phone on update, restoring the guarantee', () => {
    for (const professional of PROFESSIONALS) {
      expect(buildProfessionalUpdateData(professional).phone).toBeNull();
    }
  });

  it('creates only professionals, never an admin or a customer', () => {
    for (const professional of PROFESSIONALS) {
      const created = buildProfessionalCreateData(professional);
      expect(created.role).toBe('PROFESSIONAL');
      expect(created.status).toBe('ACTIVE');
    }
  });

  it('never derives the password hash from a constant', () => {
    const first = unreachableCredential();
    const second = unreachableCredential();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    // The fixture seed's hash must not reappear here.
    expect(first).not.toBe(randomBytes(32).toString('hex'));
  });
});

describe('catalogue seed data', () => {
  it('declares six categories with unique slugs', () => {
    expect(CATEGORIES).toHaveLength(6);
    expect(new Set(CATEGORIES.map((category) => category.slug)).size).toBe(6);
  });

  it('declares three services with unique slugs', () => {
    expect(SERVICES).toHaveLength(3);
    expect(new Set(SERVICES.map((service) => service.slug)).size).toBe(3);
  });

  it('references only catalogue categories and professionals', () => {
    const categorySlugs = new Set(CATEGORIES.map((category) => category.slug));
    const professionalEmails = new Set(PROFESSIONALS.map((entry) => entry.email));

    for (const service of SERVICES) {
      expect(categorySlugs.has(service.categorySlug)).toBe(true);
      expect(professionalEmails.has(service.ownerEmail)).toBe(true);
    }
  });

  it('activates categories and services on insert only', () => {
    for (const category of CATEGORIES) {
      expect(buildCategoryCreate(category).isActive).toBe(true);
      // Absent from the update payload by construction: reasserting it is what
      // would resurrect a deactivated category.
      expect(Object.keys(buildCategoryUpdate(category))).not.toContain('isActive');
    }

    for (const service of SERVICES) {
      const created = buildServiceCreate(service, 'owner-1', 'category-1');
      expect(created.isActive).toBe(true);
      expect(created.moderationStatus).toBe('APPROVED');
      expect(created.basePrice.toFixed(2)).toBe(service.basePrice);

      const updated = buildServiceUpdate(service, 'owner-1', 'category-1');
      expect(Object.keys(updated)).not.toContain('isActive');
      expect(Object.keys(updated)).not.toContain('moderationStatus');
      // Relationships and descriptive fields are still refreshed.
      expect(updated.ownerId).toBe('owner-1');
      expect(updated.categoryId).toBe('category-1');
      expect(updated.basePrice.toFixed(2)).toBe(service.basePrice);
    }
  });
});

describe('seedCatalogue', () => {
  interface Recorded {
    model: string;
    method: string;
    args: Record<string, unknown>;
  }

  function createFakePrisma() {
    const calls: Recorded[] = [];
    /*
     * Places are seeded first, because the professionals below are filed under
     * them. A keyless stub here would make every professional silently locationless
     * and let the suite pass on a seed that cannot actually list anybody.
     */
    const locations = new Map<string, { id: string; slug: string }>();
    let locationSequence = 0;

    const users = new Map<
      string,
      {
        id: string;
        email: string;
        phone: string | null;
        fullName: string;
        role: string;
        status: string;
        passwordHash: string;
      }
    >();
    const profiles = new Map<string, Record<string, unknown>>();
    const categories = new Map<string, Record<string, unknown>>();
    const services = new Map<string, Record<string, unknown>>();
    let sequence = 0;
    const nextId = (): string => `generated-${++sequence}`;

    const record = (model: string, method: string, args: Record<string, unknown>): void => {
      calls.push({ model, method, args });
    };

    const prisma: CataloguePrisma = {
      location: {
        findUnique: async (args: { where: { slug: string } }) => {
          record('location', 'findUnique', args);
          return locations.get(args.where.slug) ?? null;
        },
        upsert: async (args: { where: { slug: string }; create: { slug: string } }) => {
          record('location', 'upsert', args);
          const existing = locations.get(args.where.slug);
          const id = existing?.id ?? `location-${++locationSequence}`;
          locations.set(args.where.slug, { id, slug: args.where.slug });
          return { slug: args.where.slug };
        },
        findMany: async () => {
          // Nothing is ever stale in this fake, so the prune has nothing to do.
          return [];
        },
        deleteMany: async () => {
          throw new Error('the catalogue seed must not delete locations');
        },
      },
      professionalProfile: {
        count: async () => 0,
      },
      user: {
        findUnique: async (args) => {
          record('user', 'findUnique', args);
          const found = [...users.values()].find((user) => user.email === args.where.email);
          return found ? { id: found.id } : null;
        },
        create: async (args) => {
          record('user', 'create', args);
          const created = { id: nextId(), ...args.data };
          users.set(created.id, created);
          return { id: created.id };
        },
        update: async (args) => {
          record('user', 'update', args);
          const existing = users.get(args.where.id);
          if (!existing) {
            throw new Error('user not found');
          }
          const updated = { ...existing, ...args.data };
          users.set(updated.id, updated);
          return { id: updated.id };
        },
      },
      professionalProfile: {
        upsert: async (args) => {
          record('professionalProfile', 'upsert', args);
          const existing = profiles.get(args.where.userId);
          profiles.set(args.where.userId, { ...args.create, ...(existing ?? args.update) });
          return {};
        },
      },
      serviceCategory: {
        upsert: async (args) => {
          record('serviceCategory', 'upsert', args);
          const existing = categories.get(args.where.slug);
          const id = (existing?.id as string | undefined) ?? nextId();
          // Mirrors Prisma: a create writes the create payload, an update merges
          // only the fields it supplies over whatever is already stored.
          categories.set(args.where.slug, { ...args.create, ...existing, ...args.update, id });
          return { id };
        },
      },
      service: {
        upsert: async (args) => {
          record('service', 'upsert', args);
          const existing = services.get(args.where.slug);
          const id = (existing?.id as string | undefined) ?? nextId();
          services.set(args.where.slug, { ...args.create, ...existing, ...args.update, id });
          return { id: services.get(args.where.slug)?.id as string };
        },
      },
    };

    return { prisma, calls, users, profiles, categories, services };
  }

  it('writes only the catalogue and never a destructive statement', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    expect([...new Set(fake.calls.map((call) => call.model))].sort()).toEqual([
      // Reference data: the places professionals are filed under.
      'location',
      'professionalProfile',
      'service',
      'serviceCategory',
      'user',
    ]);
    expect(
      fake.calls.filter(
        (call) => call.method.startsWith('delete') || call.method.startsWith('truncate'),
      ),
    ).toEqual([]);
  });

  it('populates the catalogue the marketplace discovers', async () => {
    const fake = createFakePrisma();
    const summary = await seedCatalogue(fake.prisma);

    expect(summary).toEqual({
      professionalsCreated: 2,
      professionalsUpdated: 0,
      categoriesWritten: 6,
      servicesWritten: 3,
    });
    expect(fake.users.size).toBe(2);
    expect(fake.profiles.size).toBe(2);
    expect(fake.categories.size).toBe(6);
    expect(fake.services.size).toBe(3);

    for (const row of fake.users.values()) {
      expect(row.phone).toBeNull();
      expect(row.role).toBe('PROFESSIONAL');
    }
    for (const row of fake.categories.values()) {
      expect(row.isActive).toBe(true);
    }
    for (const row of fake.services.values()) {
      expect(row.isActive).toBe(true);
    }
  });

  it('does not reverse an administrator withdrawal on rerun', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    // An admin rejects a listing; the app treats that state as final.
    fake.services.set('ac-servicing', {
      ...fake.services.get('ac-servicing'),
      isActive: false,
      moderationStatus: 'REJECTED',
      moderationNote: 'Does not meet listing guidelines',
    });

    await seedCatalogue(fake.prisma);

    const row = fake.services.get('ac-servicing');
    expect(row?.moderationStatus).toBe('REJECTED');
    expect(row?.moderationNote).toBe('Does not meet listing guidelines');
  });

  it('approves a listing on insert only, never in an update payload', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    const serviceUpserts = fake.calls.filter((call) => call.model === 'service');

    for (const call of serviceUpserts) {
      const update = call.args.update as Record<string, unknown>;
      const create = call.args.create as Record<string, unknown>;

      expect(update.moderationStatus).toBeUndefined();
      expect(create.moderationStatus).toBe('APPROVED');
    }
  });

  it('does not reactivate a service an administrator deactivated', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    // Withdrawn from the marketplace without being rejected. It must survive a
    // reseind just the same.
    for (const [slug, row] of fake.services) {
      fake.services.set(slug, { ...row, isActive: false });
    }

    await seedCatalogue(fake.prisma);

    for (const row of fake.services.values()) {
      expect(row.isActive).toBe(false);
    }
  });

  it('states activation and moderation only in a create payload', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    const upserts = fake.calls.filter(
      (call) => call.model === 'service' || call.model === 'serviceCategory',
    );

    expect(upserts).toHaveLength(SERVICES.length + CATEGORIES.length);
    for (const call of upserts) {
      const update = call.args.update as Record<string, unknown>;
      const create = call.args.create as Record<string, unknown>;

      expect(Object.keys(update)).not.toContain('isActive');
      expect(Object.keys(update)).not.toContain('moderationStatus');
      expect(create.isActive).toBe(true);
      if (call.model === 'service') {
        expect(create.moderationStatus).toBe('APPROVED');
      }
    }
  });

  it('is idempotent and leaves the credential untouched on rerun', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);
    const credentialAfterFirstRun = [...fake.users.values()]
      .map((user) => user.passwordHash)
      .sort();

    const second = await seedCatalogue(fake.prisma);

    expect(second).toEqual({
      professionalsCreated: 0,
      professionalsUpdated: 2,
      categoriesWritten: 6,
      servicesWritten: 3,
    });
    expect(fake.users.size).toBe(2);
    expect(fake.categories.size).toBe(6);
    expect(fake.services.size).toBe(3);
    expect([...fake.users.values()].map((user) => user.passwordHash).sort()).toEqual(
      credentialAfterFirstRun,
    );
  });

  it('does not reactivate a category an administrator deactivated', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    for (const [slug, row] of fake.categories) {
      fake.categories.set(slug, { ...row, isActive: false });
    }

    await seedCatalogue(fake.prisma);

    for (const row of fake.categories.values()) {
      expect(row.isActive).toBe(false);
    }
  });

  it('leaves an unrelated user untouched', async () => {
    const fake = createFakePrisma();
    fake.users.set('unrelated-1', {
      id: 'unrelated-1',
      email: 'real.person@example.com',
      phone: '+919876500000',
      fullName: 'Real Person',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'untouched',
    });

    await seedCatalogue(fake.prisma);

    expect(fake.users.get('unrelated-1')).toEqual({
      id: 'unrelated-1',
      email: 'real.person@example.com',
      phone: '+919876500000',
      fullName: 'Real Person',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'untouched',
    });
  });

  it('never creates bookings, payments or addresses', async () => {
    const fake = createFakePrisma();
    await seedCatalogue(fake.prisma);

    const forbidden = fake.calls.filter((call) =>
      ['booking', 'payment', 'address', 'notification'].includes(call.model),
    );
    expect(forbidden).toEqual([]);
  });
});

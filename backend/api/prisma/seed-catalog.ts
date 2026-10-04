/**
 * Production catalogue seed.
 *
 * The marketplace needs reference data - the service categories customers browse
 * and the listings professionals offer - before any real account signs up. This
 * script creates exactly that, and nothing else.
 *
 * It is deliberately separate from `seed.ts`, which is a development fixture that
 * creates login-capable demo accounts, a demo booking, a payment and an address.
 * Running that against a deployed database would plant real, signable-in accounts,
 * which is why this file exists instead of relaxing the fixture.
 *
 * What it creates:
 *  - the 6 service categories, with deterministic names and sort order
 *  - 2 professional users, each with a professional profile
 *  - the 3 services those professionals own
 *
 * Activation and moderation are asserted on insert only. A rerun refreshes
 * descriptive fields and relationships, and leaves `isActive` and
 * `moderationStatus` exactly as they are, so re-running this seed can never
 * reactivate a category or listing an administrator switched off.
 *
 * What it never creates: admin accounts, customer accounts, bookings, payments,
 * addresses, notifications, reviews, or any other row.
 *
 * Sign-in safety
 * --------------
 * HELPZY has no password authentication. `AuthService.requestOtp` looks the user
 * up by normalised phone number and `verifyOtp` issues the session from that same
 * lookup, so an account is reachable if and only if some caller-supplied phone
 * number normalises to its stored `users.phone` value. A row with `phone = NULL`
 * can never be returned by that lookup, which makes these catalogue accounts
 * structurally incapable of signing in.
 *
 * `passwordHash` is required by the schema but is never compared anywhere in the
 * codebase, so it is filled with 32 bytes of randomness on insert. It is never
 * written on update and never logged: a rerun cannot resurrect a known value, and
 * no value is ever recoverable from the output.
 *
 * Targeting
 * ---------
 * A production write is irreversible in practice, so this script refuses to run
 * unless the operator names the target twice: an explicit confirmation token and
 * the exact database host, which must match the host inside `DATABASE_URL`.
 * Loopback and private-container hostnames are rejected outright, so the local
 * development database can never be targeted by accident. The repository `.env`
 * is intentionally *not* loaded - `DATABASE_URL` has to come from the operator's
 * environment, which is what makes the confirmation meaningful.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

/** Operator-supplied acknowledgement that a production write is intended. */
export const CONFIRMATION_TOKEN = 'catalogue-production-v1';

/**
 * Hosts that can never be a deliberate production target.
 *
 * `127.0.0.0/8` and the container aliases are included because a developer
 * reaching a remote-looking database through a proxy or a sibling container is
 * still not the deployed database this seed is meant for.
 */
const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  '[::1]',
  'host.docker.internal',
  'gateway.docker.internal',
]);

export interface CatalogueSeedTarget {
  host: string;
  database: string;
}

export interface CatalogueCategory {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface CatalogueProfessional {
  email: string;
  fullName: string;
  businessName: string;
  bio: string;
  serviceArea: string;
  verification: 'VERIFIED' | 'PENDING';
}

export interface CatalogueService {
  slug: string;
  title: string;
  summary: string;
  description: string;
  basePrice: string;
  durationMinutes: number;
  ownerEmail: string;
  categorySlug: string;
}

/** Written payloads, exported so tests can assert the exact shape sent to Postgres. */
export interface NewProfessionalUser {
  email: string;
  phone: null;
  fullName: string;
  role: 'PROFESSIONAL';
  status: 'ACTIVE';
  passwordHash: string;
}

export interface ProfessionalUserUpdate {
  fullName: string;
  role: 'PROFESSIONAL';
  status: 'ACTIVE';
  phone: null;
}

export interface ProfileUpdate {
  businessName: string;
  bio: string;
  serviceArea: string;
  verification: 'VERIFIED' | 'PENDING';
}

export interface ProfileWrite extends ProfileUpdate {
  userId: string;
  verifiedAt: Date | null;
}

/**
 * Activation is deliberately absent from every update payload.
 *
 * `isActive` is asserted when a row is created and never again, so a rerun cannot
 * reactivate a category or listing an administrator switched off. The update type
 * is therefore not the create type: the difference is the whole point.
 */
export interface CategoryUpdate {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface CategoryCreate extends CategoryUpdate {
  isActive: true;
}

export interface ServiceUpdate {
  slug: string;
  title: string;
  summary: string;
  description: string;
  basePrice: Prisma.Decimal;
  durationMinutes: number;
  ownerId: string;
  categoryId: string;
}

export interface ServiceCreate extends ServiceUpdate {
  isActive: true;
  moderationStatus: 'APPROVED';
}

/**
 * The slice of Prisma this seed uses.
 *
 * A generated `PrismaClient` satisfies this structurally; the single cast at the
 * call site keeps the port narrow enough to be exercised by a fake in the tests
 * without standing up a database.
 */
export interface CataloguePrisma {
  user: {
    findUnique(args: {
      where: { email: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: { data: NewProfessionalUser }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: ProfessionalUserUpdate }): Promise<{ id: string }>;
  };
  professionalProfile: {
    upsert(args: {
      where: { userId: string };
      update: ProfileUpdate;
      create: ProfileWrite;
    }): Promise<unknown>;
  };
  serviceCategory: {
    upsert(args: {
      where: { slug: string };
      update: CategoryUpdate;
      create: CategoryCreate;
    }): Promise<{ id: string }>;
  };
  service: {
    upsert(args: {
      where: { slug: string };
      update: ServiceUpdate;
      create: ServiceCreate;
    }): Promise<{ id: string }>;
  };
}

export interface CatalogueSeedSummary {
  professionalsCreated: number;
  professionalsUpdated: number;
  categoriesWritten: number;
  servicesWritten: number;
}

export const CATEGORIES: readonly CatalogueCategory[] = [
  {
    slug: 'home-services',
    name: 'Home Services',
    description: 'Cleaning, repairs, plumbing, electrical.',
    sortOrder: 10,
  },
  {
    slug: 'beauty-wellness',
    name: 'Beauty & Wellness',
    description: 'Salons, spa, massage, grooming.',
    sortOrder: 20,
  },
  {
    slug: 'education',
    name: 'Education & Tutoring',
    description: 'Tuition, coaching, skill classes.',
    sortOrder: 30,
  },
  {
    slug: 'health-fitness',
    name: 'Health & Fitness',
    description: 'Trainers, physio, nutritionists.',
    sortOrder: 40,
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    description: 'Car care, servicing, roadside help.',
    sortOrder: 50,
  },
  {
    slug: 'events',
    name: 'Events',
    description: 'Catering, decoration, event staffing.',
    sortOrder: 60,
  },
] as const;

export const PROFESSIONALS: readonly CatalogueProfessional[] = [
  {
    email: 'meera@helpzy.test',
    fullName: 'Meera Iyer',
    businessName: 'Meera Home Care',
    bio: 'Deep cleaning and appliance servicing since 2016.',
    serviceArea: 'Bengaluru',
    verification: 'VERIFIED',
  },
  {
    email: 'sameer@helpzy.test',
    fullName: 'Sameer Khan',
    businessName: 'Sameer Fitness Studio',
    bio: 'Personal training and injury rehabilitation.',
    serviceArea: 'Bengaluru',
    verification: 'PENDING',
  },
] as const;

export const SERVICES: readonly CatalogueService[] = [
  {
    ownerEmail: 'meera@helpzy.test',
    categorySlug: 'home-services',
    slug: 'full-home-deep-clean',
    title: 'Full home deep clean',
    summary: 'Kitchen, bathrooms, bedrooms and living room.',
    description:
      'A four-hour deep clean covering kitchen, bathrooms, bedrooms and living room, including appliance interiors and window tracks.',
    basePrice: '2499.00',
    durationMinutes: 240,
  },
  {
    ownerEmail: 'meera@helpzy.test',
    categorySlug: 'home-services',
    slug: 'ac-servicing',
    title: 'AC servicing',
    summary: 'Split and window AC service with gas check.',
    description:
      'Standard servicing for split and window air conditioners, including coil cleaning, filter replacement and a gas level check.',
    basePrice: '899.00',
    durationMinutes: 90,
  },
  {
    ownerEmail: 'sameer@helpzy.test',
    categorySlug: 'health-fitness',
    slug: 'personal-training-session',
    title: 'Personal training session',
    summary: 'One hour of one-to-one coaching.',
    description:
      'A one-hour one-to-one session covering strength, mobility and conditioning, with a written plan after the first visit.',
    basePrice: '1200.00',
    durationMinutes: 60,
  },
] as const;

export function isForbiddenHost(host: string): boolean {
  return (
    FORBIDDEN_HOSTS.has(host) ||
    host.startsWith('127.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

/**
 * Reads the target database out of `DATABASE_URL` without ever logging it, so no
 * password can reach stdout, a log aggregator or a shell history.
 */
export function parseDatabaseUrl(databaseUrl: string): CatalogueSeedTarget {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a parsable URL.');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL must be a PostgreSQL URL, received "${parsed.protocol}".`);
  }

  return {
    host: parsed.hostname.toLowerCase(),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

/**
 * Requires the operator to name the target twice before any connection is opened.
 *
 * Throws with a refusal reason on every failure, so the script fails closed
 * instead of writing to whatever database happens to be configured.
 */
export function assertExplicitTarget(env: NodeJS.ProcessEnv = process.env): CatalogueSeedTarget {
  const confirmation = env.CATALOGUE_SEED_CONFIRM;
  if (confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(
      `Set CATALOGUE_SEED_CONFIRM=${CONFIRMATION_TOKEN} to confirm this seed is intended.`,
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. This seed never loads the repository .env, so the target must be supplied explicitly.',
    );
  }

  const target = parseDatabaseUrl(databaseUrl);

  if (isForbiddenHost(target.host)) {
    throw new Error(`"${target.host}" is a local address, which is never a valid target.`);
  }

  const declaredHost = env.CATALOGUE_SEED_TARGET_HOST?.trim().toLowerCase();
  if (!declaredHost) {
    throw new Error('Set CATALOGUE_SEED_TARGET_HOST to the expected database host.');
  }

  if (declaredHost !== target.host) {
    throw new Error(
      `CATALOGUE_SEED_TARGET_HOST "${declaredHost}" does not match the DATABASE_URL host "${target.host}".`,
    );
  }

  return target;
}

/**
 * A password hash that corresponds to no password anyone knows.
 *
 * Never persisted on update, so reruns cannot reset an existing row to a value
 * derived from a public constant, and never written to the output.
 */
export function unreachableCredential(): string {
  return randomBytes(32).toString('hex');
}

export function buildProfessionalCreateData(
  professional: CatalogueProfessional,
): NewProfessionalUser {
  return {
    email: professional.email,
    // See the sign-in safety note at the top of the file: a NULL phone cannot be
    // produced by `normalizePhone`, so this account can never be signed into.
    phone: null,
    fullName: professional.fullName,
    role: 'PROFESSIONAL',
    status: 'ACTIVE',
    passwordHash: unreachableCredential(),
  };
}

export function buildProfessionalUpdateData(
  professional: CatalogueProfessional,
): ProfessionalUserUpdate {
  return {
    fullName: professional.fullName,
    role: 'PROFESSIONAL',
    // `ACTIVE` is required for marketplace discovery, so it is asserted on every
    // run rather than only on insert.
    status: 'ACTIVE',
    // Cleared on update too: if an earlier fixture run left a reachable phone on
    // one of these rows, removing it is what restores the sign-in guarantee.
    phone: null,
  };
}

export function buildProfileWrite(
  professional: CatalogueProfessional,
  userId: string,
  createdAt: Date,
): ProfileWrite {
  return {
    userId,
    businessName: professional.businessName,
    bio: professional.bio,
    serviceArea: professional.serviceArea,
    verification: professional.verification,
    // Only meaningful on insert: rewriting it on every run would make the
    // timestamp depend on when the seed happened to be re-executed.
    verifiedAt: professional.verification === 'VERIFIED' ? createdAt : null,
  };
}

export function buildCategoryUpdate(category: CatalogueCategory): CategoryUpdate {
  return {
    slug: category.slug,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
  };
}

export function buildCategoryCreate(category: CatalogueCategory): CategoryCreate {
  return { ...buildCategoryUpdate(category), isActive: true };
}

export function buildServiceUpdate(
  service: CatalogueService,
  ownerId: string,
  categoryId: string,
): ServiceUpdate {
  return {
    slug: service.slug,
    title: service.title,
    summary: service.summary,
    description: service.description,
    basePrice: new Prisma.Decimal(service.basePrice),
    durationMinutes: service.durationMinutes,
    ownerId,
    categoryId,
  };
}

export function buildServiceCreate(
  service: CatalogueService,
  ownerId: string,
  categoryId: string,
): ServiceCreate {
  // `isActive` and `moderationStatus` are stated once, at insert. Reasserting them
  // on a rerun would quietly reverse an administrator's moderation decision, which
  // the app otherwise treats as final.
  return {
    ...buildServiceUpdate(service, ownerId, categoryId),
    isActive: true,
    moderationStatus: 'APPROVED',
  };
}

/**
 * Writes the catalogue.
 *
 * Every write is an upsert keyed on a natural unique column, so a rerun converges
 * instead of duplicating, and no statement here can remove a row. The only rows
 * this can touch are the ones keyed by the two catalogue emails and the category
 * and service slugs above.
 */
export async function seedCatalogue(prisma: CataloguePrisma): Promise<CatalogueSeedSummary> {
  const now = new Date();
  const summary: CatalogueSeedSummary = {
    professionalsCreated: 0,
    professionalsUpdated: 0,
    categoriesWritten: 0,
    servicesWritten: 0,
  };

  const ownerIdsByEmail = new Map<string, string>();

  for (const professional of PROFESSIONALS) {
    const existing = await prisma.user.findUnique({
      where: { email: professional.email },
      select: { id: true },
    });

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: buildProfessionalUpdateData(professional),
        })
      : await prisma.user.create({ data: buildProfessionalCreateData(professional) });

    if (existing) {
      summary.professionalsUpdated += 1;
    } else {
      summary.professionalsCreated += 1;
    }

    const profile = buildProfileWrite(professional, user.id, now);
    await prisma.professionalProfile.upsert({
      where: { userId: user.id },
      // `verifiedAt` is deliberately absent from the update branch: it records
      // when verification happened, which a reseed must not rewrite.
      update: {
        businessName: profile.businessName,
        bio: profile.bio,
        serviceArea: profile.serviceArea,
        verification: profile.verification,
      },
      create: profile,
    });

    ownerIdsByEmail.set(professional.email, user.id);
  }

  const categoryIdsBySlug = new Map<string, string>();

  for (const category of CATEGORIES) {
    const row = await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: buildCategoryUpdate(category),
      create: buildCategoryCreate(category),
    });

    categoryIdsBySlug.set(category.slug, row.id);
    summary.categoriesWritten += 1;
  }

  for (const service of SERVICES) {
    const ownerId = ownerIdsByEmail.get(service.ownerEmail);
    const categoryId = categoryIdsBySlug.get(service.categorySlug);

    // Referential integrity is decided from this script's own constants rather
    // than a database lookup, so a typo fails here instead of half-writing rows.
    if (!ownerId || !categoryId) {
      throw new Error(
        `Service "${service.slug}" refers to an owner or category this seed did not write.`,
      );
    }

    await prisma.service.upsert({
      where: { slug: service.slug },
      update: buildServiceUpdate(service, ownerId, categoryId),
      create: buildServiceCreate(service, ownerId, categoryId),
    });

    summary.servicesWritten += 1;
  }

  return summary;
}

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<CatalogueSeedSummary> {
  const target = assertExplicitTarget(env);
  // Host and database name are enough for an operator to confirm the target and
  // are not credentials; the connection string itself is never printed.
  console.log(`Catalogue seed target: ${target.host}/${target.database}`);

  const prisma = new PrismaClient();
  try {
    return await seedCatalogue(prisma as unknown as CataloguePrisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run()
    .then((summary) => {
      console.log(
        `Catalogue seed complete: ${summary.categoriesWritten} categories, ` +
          `${summary.servicesWritten} services, ` +
          `${summary.professionalsCreated} professionals created, ` +
          `${summary.professionalsUpdated} professionals refreshed.`,
      );
      console.log('No accounts, bookings, payments or addresses were created.');
    })
    .catch((error: unknown) => {
      console.error('Catalogue seed refused:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

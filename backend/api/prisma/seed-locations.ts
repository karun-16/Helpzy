/**
 * Writes the marketplace location dataset into PostgreSQL.
 *
 * Reads `@helpzy/config` - the same array the customer's picker renders and the
 * API validates against - so a place can never exist in the app but not in the
 * database, or the reverse.
 *
 * Idempotent by construction: every write is an upsert on the unique `slug`.
 * Running it again refreshes names and coordinates and adds anything new; it never
 * deletes, and it never touches `professional_profiles.locationId`, so
 * re-running cannot unassign a professional.
 *
 * Usable in production. Unlike the development fixture seed it creates no
 * accounts, no bookings and no payments - only places.
 */
import { MARKETPLACE_LOCATIONS } from '@helpzy/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';

export interface LocationSeedSummary {
  created: number;
  updated: number;
  total: number;
  /** Rows removed because the dataset no longer lists them. */
  pruned: number;
  /** Rows left in place because a professional is still filed under them. */
  retained: number;
}

export interface LocationSeedClient {
  location: {
    deleteMany(args: { where: { slug: { in: string[] } } }): Promise<{ count: number }>;
    findMany(args: {
      where: { slug: { notIn: string[] } };
      select: { id: true; slug: true };
    }): Promise<{ id: string; slug: string }[]>;
    upsert(args: {
      where: { slug: string };
      update: {
        stateCode: string;
        state: string;
        districtSlug: string;
        district: string;
        citySlug: string;
        city: string;
        latitude: Prisma.Decimal;
        longitude: Prisma.Decimal;
        isMajor: boolean;
        sortOrder: number;
      };
      create: {
        slug: string;
        stateCode: string;
        state: string;
        districtSlug: string;
        district: string;
        citySlug: string;
        city: string;
        latitude: Prisma.Decimal;
        longitude: Prisma.Decimal;
        isMajor: boolean;
        sortOrder: number;
      };
    }): Promise<{ slug: string }>;
    findUnique(args: {
      where: { slug: string };
      select?: { id?: boolean; slug?: boolean };
    }): Promise<{ slug: string; id?: string } | null>;
  };
  /** Read only: used to decide whether a stale row is safe to delete. */
  professionalProfile: {
    count(args: { where: { locationId: { in: string[] } } }): Promise<number>;
  };
}

export async function seedLocations(prisma: LocationSeedClient): Promise<LocationSeedSummary> {
  const summary: LocationSeedSummary = {
    created: 0,
    updated: 0,
    total: 0,
    pruned: 0,
    retained: 0,
  };

  for (const location of MARKETPLACE_LOCATIONS) {
    const existing = await prisma.location.findUnique({ where: { slug: location.slug } });

    const values = {
      stateCode: location.stateCode,
      state: location.state,
      districtSlug: location.districtSlug,
      district: location.district,
      citySlug: location.citySlug,
      city: location.city,
      latitude: new Prisma.Decimal(location.latitude),
      longitude: new Prisma.Decimal(location.longitude),
      isMajor: location.major,
      sortOrder: location.sortOrder,
    };

    await prisma.location.upsert({
      where: { slug: location.slug },
      update: values,
      create: { slug: location.slug, ...values },
    });

    if (existing) {
      summary.updated += 1;
    } else {
      summary.created += 1;
    }
  }

  summary.total = MARKETPLACE_LOCATIONS.length;

  const { pruned, retained } = await pruneRemovedLocations(prisma);
  summary.pruned = pruned;
  summary.retained = retained;

  return summary;
}

/**
 * Removes rows the dataset no longer lists, so the table matches the one
 * authoritative list.
 *
 * Upsert alone is not enough once the dataset itself is corrected. When Andhra
 * Pradesh reorganised its districts, a town that changed district kept its old
 * row: the new slug was inserted, the old one stayed, and the district browser
 * then showed both "Anantapur" and "Ananthapuramu". The stale row is not merely
 * untidy - it is a place the app can no longer explain.
 *
 * The guard is the whole point. A row is deleted only when nothing references it,
 * so this can never unassign a professional; a referenced row is left alone and
 * reported, because silently deleting it would break a live profile and silently
 * keeping it is the safer of the two failures.
 */
async function pruneRemovedLocations(
  prisma: LocationSeedClient,
): Promise<{ pruned: number; retained: number }> {
  const currentSlugs = MARKETPLACE_LOCATIONS.map((location) => location.slug);
  const stale = await prisma.location.findMany({
    where: { slug: { notIn: currentSlugs } },
    select: { id: true, slug: true },
  });

  if (stale.length === 0) {
    return { pruned: 0, retained: 0 };
  }

  /*
   * `professional_profiles.locationId` is a `Restrict` foreign key, so the delete
   * below is rejected by PostgreSQL if anything still points at the row. Counting
   * the candidates and only deleting when none are referenced keeps that guarantee
   * explicit instead of relying on a constraint error as control flow.
   */
  const referenced = await prisma.professionalProfile.count({
    where: { locationId: { in: stale.map((row) => row.id) } },
  });

  if (referenced > 0) {
    return { pruned: 0, retained: stale.length };
  }

  const { count } = await prisma.location.deleteMany({
    where: { slug: { in: stale.map((row) => row.slug) } },
  });

  return { pruned: count, retained: 0 };
}

/**
 * Loads the repository-root `.env` when `DATABASE_URL` is not already set.
 *
 * `scripts/prisma.mjs` does this for every `db:*` command, but this file is also
 * runnable directly through `pnpm db:seed:locations`, which bypasses that wrapper.
 * Without it the seed fails with the opaque "Environment variable not found:
 * DATABASE_URL", which reads like a broken script rather than a missing env file.
 *
 * An already-set `DATABASE_URL` always wins, so a production operator who exports
 * the variable explicitly is never redirected to the development database.
 */
function loadRepositoryEnv(): void {
  if (process.env.DATABASE_URL) return;

  const envFile = resolve(join(__dirname, '..', '..', '..', '.env'));
  if (!existsSync(envFile)) return;

  loadDotEnv({ path: envFile, quiet: true });
}

export async function runLocationsSeed(): Promise<LocationSeedSummary> {
  loadRepositoryEnv();

  const prisma = new PrismaClient();
  try {
    return await seedLocations(prisma as unknown as LocationSeedClient);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runLocationsSeed()
    .then((summary) => {
      console.log(
        `Locations seeded: ${summary.total} total, ${summary.created} created, ` +
          `${summary.updated} updated, ${summary.pruned} removed` +
          (summary.retained > 0 ? `, ${summary.retained} kept (still in use).` : '.'),
      );
    })
    .catch((error: unknown) => {
      console.error('Location seed failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

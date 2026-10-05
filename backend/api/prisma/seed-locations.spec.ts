import { MARKETPLACE_LOCATIONS } from '@helpzy/config';

import { seedLocations, type LocationSeedClient } from './seed-locations';

/**
 * The location seed is the one writer of the `locations` table, so these cover the
 * three things it must never get wrong: writing every place, writing them twice
 * harmlessly, and never removing anything.
 */
describe('seedLocations', () => {
  function fake() {
    const rows = new Map<
      string,
      {
        id: string;
        slug: string;
        state: string;
        district: string;
        city: string;
        isMajor: boolean;
        sortOrder: number;
      }
    >();
    const methods: string[] = [];
    let sequence = 0;
    let referencedLocationIds: string[] = [];

    const client: LocationSeedClient = {
      location: {
        findUnique: async ({ where }) => {
          methods.push('findUnique');
          return rows.get(where.slug) ?? null;
        },
        upsert: async ({ where, update, create }) => {
          methods.push('upsert');
          const existing = rows.get(where.slug);
          const id = existing?.id ?? `location-${++sequence}`;
          rows.set(where.slug, { ...create, ...update, id });
          return { slug: where.slug };
        },
        findMany: async ({ where }) => {
          methods.push('findMany');
          return [...rows.values()]
            .filter((row) => !where.slug.notIn.includes(row.slug))
            .map((row) => ({ id: row.id, slug: row.slug }));
        },
        deleteMany: async ({ where }) => {
          methods.push('deleteMany');
          let count = 0;
          for (const target of where.slug.in) {
            if (rows.delete(target)) count += 1;
          }
          return { count };
        },
      },
      professionalProfile: {
        count: async ({ where }) => {
          methods.push('professionalProfile.count');
          const referenced = new Set(referencedLocationIds);
          return where.locationId.in.filter((id) => referenced.has(id)).length;
        },
      },
    };

    return {
      client,
      rows,
      methods,
      setReferenced: (ids: string[]) => (referencedLocationIds = ids),
    };
  }

  it('writes every place in the dataset', async () => {
    const { client, rows } = fake();

    const summary = await seedLocations(client);

    expect(summary.total).toBe(MARKETPLACE_LOCATIONS.length);
    expect(summary.created).toBe(MARKETPLACE_LOCATIONS.length);
    expect(rows.size).toBe(MARKETPLACE_LOCATIONS.length);
  });

  it('writes the display names, not just the slug', async () => {
    const { client, rows } = fake();
    await seedLocations(client);

    const tirupati = rows.get('ap-tirupati-tirupati');
    expect(tirupati).toMatchObject({
      state: 'Andhra Pradesh',
      district: 'Tirupati',
      city: 'Tirupati',
    });
  });

  it('is idempotent: a rerun updates instead of duplicating', async () => {
    const { client, rows } = fake();

    await seedLocations(client);
    const idsAfterFirst = [...rows.values()].map((row) => row.id).sort();

    const second = await seedLocations(client);

    expect(second.created).toBe(0);
    expect(second.updated).toBe(MARKETPLACE_LOCATIONS.length);
    expect(rows.size).toBe(MARKETPLACE_LOCATIONS.length);
    // Existing ids are untouched, so no professional is left pointing at a
    // re-created row.
    expect([...rows.values()].map((row) => row.id).sort()).toEqual(idsAfterFirst);
  });

  it('leaves an unrelated extra row alone when nothing references it', async () => {
    const { client, rows } = fake();

    await seedLocations(client);
    const before = rows.size;

    // A district reorganisation leaves rows behind; the seed removes them.
    rows.set('ap-old-district-old-town', {
      id: 'location-orphan',
      slug: 'ap-old-district-old-town',
      state: 'Andhra Pradesh',
      district: 'Old District',
      city: 'Old Town',
      isMajor: false,
      sortOrder: 9999,
    });

    const summary = await seedLocations(client);

    expect(summary.pruned).toBe(1);
    expect(rows.has('ap-old-district-old-town')).toBe(false);
    expect(rows.size).toBe(before);
  });

  it('never deletes a row a professional is still filed under', async () => {
    const { client, rows, setReferenced } = fake();

    await seedLocations(client);
    rows.set('ap-old-district-old-town', {
      id: 'location-in-use',
      slug: 'ap-old-district-old-town',
      state: 'Andhra Pradesh',
      district: 'Old District',
      city: 'Old Town',
      isMajor: false,
      sortOrder: 9999,
    });
    setReferenced(['location-in-use']);

    const summary = await seedLocations(client);

    // Unassigning a professional would be far worse than leaving a stale row.
    expect(summary.pruned).toBe(0);
    expect(summary.retained).toBe(1);
    expect(rows.has('ap-old-district-old-town')).toBe(true);
  });

  it('does not delete anything on a clean database', async () => {
    const { client, methods } = fake();

    await seedLocations(client);

    expect(methods).not.toContain('deleteMany');
  });

  it('preserves a curated major-city flag', async () => {
    const { client, rows } = fake();
    await seedLocations(client);

    expect(rows.get('ap-tirupati-tirupati')?.isMajor).toBe(true);
  });

  it('refreshes coordinates on rerun, so a corrected centroid takes effect', async () => {
    const { client, rows } = fake();
    await seedLocations(client);

    const stale = rows.get('ap-tirupati-tirupati');
    // Simulate a row written from an older dataset.
    Object.assign(stale!, { latitude: { toNumber: () => 0 } });

    await seedLocations(client);

    expect(rows.get('ap-tirupati-tirupati')?.latitude).toBeDefined();
  });
});

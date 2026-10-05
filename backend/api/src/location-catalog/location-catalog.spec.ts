import {
  MARKETPLACE_LOCATIONS,
  findMarketplaceLocation,
  majorMarketplaceLocations,
  marketplaceCities,
  marketplaceDistricts,
  marketplaceStates,
  nearestMarketplaceLocation,
  slugifyLocationName,
} from '@helpzy/config';

import { LocationCatalogService } from './location-catalog.service';

/**
 * Two things are guarded here.
 *
 * First, the shape of the dataset: it is the single source of truth for where
 * HELPZY trades, so a place name appearing in three files would drift and a name
 * in one array cannot.
 *
 * Second, the service that turns a submitted slug into a database row, because
 * that is the boundary where an untrusted value stops being a string and becomes
 * a query.
 */

/** The `locations` columns `LocationCatalogService` reads. Coordinates are included
 * because the real row has them, and one test asserts they are never handed on. */
interface LocationRowStub {
  id: string;
  slug: string;
  state: string;
  district: string;
  city: string;
  latitude?: { toNumber: () => number };
  longitude?: { toNumber: () => number };
}

const prisma = {
  location: {
    /*
     * The explicit return type is load-bearing: without it Jest infers
     * `Promise<null>` from the initial implementation, and every later
     * `mockResolvedValue(row)` is then a type error rather than a test.
     */
    findUnique: jest.fn(async (): Promise<LocationRowStub | null> => null),
  },
};

function service(): LocationCatalogService {
  return new LocationCatalogService(prisma as never);
}

describe('marketplace location dataset', () => {
  it('has at least one state and a non-trivial number of places', () => {
    expect(marketplaceStates().length).toBeGreaterThanOrEqual(1);
    expect(MARKETPLACE_LOCATIONS.length).toBeGreaterThan(50);
  });

  it('uses unique slugs, so one place can never be two rows', () => {
    const slugs = MARKETPLACE_LOCATIONS.map((location) => location.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every entry a state, a district and a city', () => {
    for (const location of MARKETPLACE_LOCATIONS) {
      expect(location.state.length).toBeGreaterThan(0);
      expect(location.district.length).toBeGreaterThan(0);
      expect(location.city.length).toBeGreaterThan(0);
    }
  });

  it('keeps coordinates inside India', () => {
    // A transposed digit pair would otherwise send a Tirupati customer to the
    // middle of Rajasthan, or resolve to nothing at all.
    for (const location of MARKETPLACE_LOCATIONS) {
      expect(location.latitude).toBeGreaterThanOrEqual(6);
      expect(location.latitude).toBeLessThanOrEqual(37);
      expect(location.longitude).toBeGreaterThanOrEqual(68);
      expect(location.longitude).toBeLessThanOrEqual(98);
    }
  });

  it('gives every district at least one city', () => {
    for (const district of marketplaceDistricts('AP')) {
      expect(marketplaceCities('AP', district).length).toBeGreaterThan(0);
    }
  });

  /*
   * The rule that makes the cascading picker correct: a city's identity is the
   * state and district it sits in, not the word on its own.
   */
  it('scopes a city name to its own district', () => {
    const tirupati = marketplaceCities('AP', 'Tirupati').map((city) => city.city);
    const visakhapatnam = marketplaceCities('AP', 'Visakhapatnam').map((city) => city.city);

    expect(tirupati).toContain('Tirupati');
    expect(tirupati).not.toContain('Visakhapatnam');
    expect(visakhapatnam).toContain('Visakhapatnam');
    expect(visakhapatnam).not.toContain('Tirupati');
  });

  it('returns nothing for an unknown state or district', () => {
    expect(marketplaceDistricts('ZZ')).toEqual([]);
    expect(marketplaceCities('AP', 'Nowhere District')).toEqual([]);
  });

  it('handles a city name shared by two districts as two distinct places', () => {
    // Udayagiri exists in both SPSR Nellore and Parvathipuram Manyam. A filter on
    // the city name alone would merge them; the (state, district, city) slug does
    // not.
    const matches = MARKETPLACE_LOCATIONS.filter((location) => location.city === 'Udayagiri');
    expect(matches.length).toBeGreaterThan(1);
    expect(new Set(matches.map((location) => location.slug)).size).toBe(matches.length);
  });

  it('offers a curated list including the cities the demonstration needs', () => {
    const major = majorMarketplaceLocations().map((location) => location.city);
    expect(major.length).toBeGreaterThanOrEqual(10);
    expect(major).toContain('Tirupati');
    expect(major).toContain('Vijayawada');
    expect(major).toContain('Visakhapatnam');
  });

  it('produces URL-safe slugs for every entry', () => {
    for (const location of MARKETPLACE_LOCATIONS) {
      expect(location.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe('slugifyLocationName', () => {
  it.each([
    ['Tirupati', 'tirupati'],
    ['NTR', 'ntr'],
    ['Sri Potti Sriramulu Nellore', 'sri-potti-sriramulu-nellore'],
    ['YSR Kadapa', 'ysr-kadapa'],
    ['Alluri Sitharama Raju', 'alluri-sitharama-raju'],
  ])('turns %s into %s', (input, expected) => {
    expect(slugifyLocationName(input)).toBe(expected);
  });
});

describe('nearestMarketplaceLocation', () => {
  it('resolves a fix inside Tirupati to Tirupati', () => {
    expect(nearestMarketplaceLocation({ latitude: 13.63, longitude: 79.42 })?.city).toBe(
      'Tirupati',
    );
  });

  it('resolves a fix inside Visakhapatnam to Visakhapatnam', () => {
    expect(nearestMarketplaceLocation({ latitude: 17.69, longitude: 83.22 })?.city).toBe(
      'Visakhapatnam',
    );
  });

  it('always returns a supported place, so detection never dead-ends', () => {
    const nearest = nearestMarketplaceLocation({ latitude: 15.5, longitude: 80.0 });
    expect(nearest?.slug).toMatch(/^ap-/);
  });

  it('handles an extreme coordinate without throwing', () => {
    expect(() => nearestMarketplaceLocation({ latitude: 0, longitude: 0 })).not.toThrow();
    expect(() => nearestMarketplaceLocation({ latitude: 90, longitude: 180 })).not.toThrow();
  });
});

describe('LocationCatalogService', () => {
  beforeEach(() => {
    prisma.location.findUnique.mockReset();
  });

  it('resolves a supported slug to its row', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 'c0000000-0000-4000-8000-000000000001',
      slug: 'ap-tirupati-tirupati',
      state: 'Andhra Pradesh',
      district: 'Tirupati',
      city: 'Tirupati',
    });

    await expect(service().requireForFilter('ap-tirupati-tirupati')).resolves.toMatchObject({
      id: 'c0000000-0000-4000-8000-000000000001',
      city: 'Tirupati',
    });
  });

  it('never returns coordinates, even though the row holds them', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 'c0000000-0000-4000-8000-000000000001',
      slug: 'ap-tirupati-tirupati',
      state: 'Andhra Pradesh',
      district: 'Tirupati',
      city: 'Tirupati',
      latitude: { toNumber: () => 13.63 },
      longitude: { toNumber: () => 79.42 },
    });

    const resolved = await service().requireForFilter('ap-tirupati-tirupati');
    expect(resolved).not.toHaveProperty('latitude');
    expect(resolved).not.toHaveProperty('longitude');
  });

  it('rejects a slug the dataset does not know, without querying', async () => {
    await expect(service().requireForFilter('ap-nowhere-nowhere')).rejects.toThrow(
      /not one HELPZY serves/,
    );
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a malformed slug rather than passing it through', async () => {
    for (const value of ['', '   ', "'; DROP TABLE users; --", '../../etc/passwd', 'TIRUPATI']) {
      await expect(service().requireForFilter(value)).rejects.toThrow();
    }
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });

  it('reports a seeded-dataset-but-unseeded-database as a server problem', async () => {
    // The slug is real, but the row is missing because the operator has not run
    // the location seed. That is a 503, not a 400: the customer did nothing
    // wrong and retrying later is the correct advice.
    prisma.location.findUnique.mockResolvedValue(null);

    await expect(service().requireForFilter('ap-tirupati-tirupati')).rejects.toThrow(
      /not ready yet/,
    );
  });

  it('treats an absent, empty or null slug as "no location"', async () => {
    for (const value of [undefined, null, '', '   ']) {
      await expect(service().optional(value)).resolves.toBeNull();
    }
    expect(prisma.location.findUnique).not.toHaveBeenCalled();
  });

  it('resolves a slug supplied through optional()', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 'c0000000-0000-4000-8000-000000000002',
      slug: 'ap-ntr-vijayawada',
      state: 'Andhra Pradesh',
      district: 'NTR',
      city: 'Vijayawada',
    });

    await expect(service().optional('ap-ntr-vijayawada')).resolves.toMatchObject({
      city: 'Vijayawada',
    });
  });

  it('rejects an unknown slug through optional() too', async () => {
    await expect(service().optional('ap-nowhere-nowhere')).rejects.toThrow();
  });

  it('resolves the dataset entry it validated against, not a caller-supplied name', async () => {
    prisma.location.findUnique.mockResolvedValue({
      id: 'c0000000-0000-4000-8000-000000000001',
      slug: 'ap-tirupati-tirupati',
      state: 'Andhra Pradesh',
      district: 'Tirupati',
      city: 'Tirupati',
    });

    // Case and padding must not matter: only the canonical slug reaches the query.
    await service().requireForFilter('  AP-Tirupati-Tirupati ');
    expect(prisma.location.findUnique).toHaveBeenCalledWith({
      where: { slug: findMarketplaceLocation('AP-Tirupati-Tirupati')?.slug },
    });
  });
});

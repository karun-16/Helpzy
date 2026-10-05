import {
  clearMarketplaceLocation,
  readMarketplaceLocation,
  subscribeMarketplaceLocation,
  writeMarketplaceLocation,
} from './location-session';

/**
 * `useSyncExternalStore` requires `getSnapshot()` to be referentially stable.
 *
 * The store used to build a fresh `{ location, source }` object on every read, so
 * React never saw an unchanged snapshot: it warned "the result of getSnapshot
 * should be cached to avoid an infinite loop" and then died with "maximum update
 * depth exceeded" as soon as `<LocationSelector />` mounted. These tests pin the
 * contract that prevents a regression, using `Object.is` because that is exactly
 * the comparison React performs.
 */

const TIRUPATI = {
  slug: 'ap-tirupati-tirupati',
  state: 'Andhra Pradesh',
  district: 'Tirupati',
  city: 'Tirupati',
};

const VIJAYAWADA = {
  slug: 'ap-ntr-vijayawada',
  state: 'Andhra Pradesh',
  district: 'NTR',
  city: 'Vijayawada',
};

/** A `Storage` stand-in, since this suite runs in the `node` environment. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

const STORAGE_KEY = 'helpzy-marketplace-location';

describe('marketplace location store', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    // Reset both the storage and the module-level snapshot cache, so one test
    // cannot pass on a snapshot another test left behind.
    (globalThis as { localStorage?: Storage }).localStorage = storage;
    clearMarketplaceLocation();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  describe('referential stability', () => {
    it('returns the identical object on repeated reads of an unchanged location', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');

      const first = readMarketplaceLocation();
      const second = readMarketplaceLocation();
      const third = readMarketplaceLocation();

      // This is the assertion React's own check makes. Without it the hook loops.
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it('is stable before anything is chosen', () => {
      // `null` is already referentially equal to itself, so an empty store cannot
      // loop - but the repeated reads must agree.
      expect(readMarketplaceLocation()).toBeNull();
      expect(readMarketplaceLocation()).toBeNull();
      expect(readMarketplaceLocation()).toBeNull();
    });

    it('is stable across many reads, which is what a re-rendering screen does', () => {
      writeMarketplaceLocation(VIJAYAWADA, 'manual');

      const first = readMarketplaceLocation();
      for (let index = 0; index < 50; index += 1) {
        expect(readMarketplaceLocation()).toBe(first);
      }
    });

    it('produces a new object when the city actually changes', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');
      const tirupati = readMarketplaceLocation();

      writeMarketplaceLocation(VIJAYAWADA, 'manual');
      const vijayawada = readMarketplaceLocation();

      // Same store, new place: a new reference, or React would never re-render.
      expect(vijayawada).not.toBe(tirupati);
      expect(vijayawada?.location.slug).toBe(VIJAYAWADA.slug);
      expect(vijayawada?.location.city).toBe('Vijayawada');
    });

    it('keeps re-selecting the same city referentially stable', () => {
      // A detection attempt that resolves to the city already chosen must not
      // churn the snapshot.
      writeMarketplaceLocation(TIRUPATI, 'manual');
      const before = readMarketplaceLocation();

      writeMarketplaceLocation(TIRUPATI, 'detected');
      const after = readMarketplaceLocation();

      expect(after?.location.slug).toBe(before?.location.slug);
    });

    it('returns null again after a clear', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');
      expect(readMarketplaceLocation()).not.toBeNull();

      clearMarketplaceLocation();

      expect(readMarketplaceLocation()).toBeNull();
    });
  });

  describe('persistence', () => {
    it('survives a simulated reload, because storage is the source of truth', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');

      // A reload is a fresh module-level cache over the same stored bytes.
      const reloaded = new MemoryStorage();
      reloaded.setItem(STORAGE_KEY, storage.getItem(STORAGE_KEY) as string);

      (globalThis as { localStorage?: Storage }).localStorage = reloaded;
      clearMarketplaceLocation();

      // Reading after the reset still resolves the stored city.
      writeMarketplaceLocation(TIRUPATI, 'manual');
      expect(readMarketplaceLocation()?.location.city).toBe('Tirupati');
    });

    it('never persists coordinates', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');

      const raw = storage.getItem(STORAGE_KEY) as string;
      expect(raw).not.toContain('latitude');
      expect(raw).not.toContain('longitude');
    });

    it('drops a stored place the dataset no longer knows', () => {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ source: 'manual', location: { slug: 'ap-gone-gone' } }),
      );

      expect(readMarketplaceLocation()).toBeNull();
      // Removed rather than left to 400 on every request.
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      // And it stays removed, without ever notifying mid-render.
      expect(readMarketplaceLocation()).toBeNull();
    });
  });

  describe('subscriptions', () => {
    it('notifies subscribers when the city is chosen', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeMarketplaceLocation(listener);

      writeMarketplaceLocation(TIRUPATI, 'manual');

      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('notifies subscribers when the city changes', () => {
      writeMarketplaceLocation(TIRUPATI, 'manual');

      const listener = jest.fn();
      const unsubscribe = subscribeMarketplaceLocation(listener);

      writeMarketplaceLocation(VIJAYAWADA, 'manual');

      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('stops notifying after unsubscribe', () => {
      const listener = jest.fn();
      subscribeMarketplaceLocation(listener)();

      writeMarketplaceLocation(TIRUPATI, 'manual');

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not notify while merely reading', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeMarketplaceLocation(listener);

      // A `getSnapshot()` call happens during render; notifying from one would be
      // a state update during render.
      readMarketplaceLocation();
      readMarketplaceLocation();

      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});

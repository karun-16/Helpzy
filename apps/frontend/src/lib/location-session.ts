import type { MarketplaceLocationSelection } from '@helpzy/types';

import { findMarketplaceLocation } from '@helpzy/config';

/**
 * Where the customer currently wants to find services.
 *
 * Kept separate from the signed-in profile on purpose. A customer's registered
 * address is where a job gets delivered; this is "show me providers around here
 * right now". Someone in Tirupati looking for a plumber in Vijayawada should not
 * have to edit their home address to do it.
 *
 * Stored in `localStorage` alongside the session, under its own key so signing
 * out clears the account without silently changing which city the marketplace
 * shows for a guest browsing on the same device.
 *
 * A stored value is re-validated against `@helpzy/config` on read. The dataset can
 * gain or lose places between app versions, and a remembered slug that no longer
 * exists would otherwise be sent to the API forever and 400 on every load.
 */

const STORAGE_KEY = 'helpzy-marketplace-location';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeMarketplaceLocation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    return window.localStorage;
  }
  if ('localStorage' in globalThis) {
    return globalThis.localStorage as Storage;
  }
  return null;
}

function isSelection(value: unknown): value is MarketplaceLocationSelection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<MarketplaceLocationSelection>;
  return (
    typeof candidate.source === 'string' &&
    (candidate.source === 'detected' || candidate.source === 'manual') &&
    typeof candidate.location === 'object' &&
    candidate.location !== null &&
    typeof candidate.location.slug === 'string'
  );
}

/**
 * Cached snapshot for `useSyncExternalStore`.
 *
 * Without this, every call built a fresh `{ location, source }` object, and React
 * compares `getSnapshot()` with `Object.is` after each render. A new reference is
 * never equal, so React concluded the store had changed and re-rendered
 * immediately - which is the "result of getSnapshot should be cached" warning and
 * the "maximum update depth exceeded" crash that followed it.
 *
 * The cache is keyed on the raw stored string, exactly as `readAuthSession` does
 * for the session, so it cannot go stale: the string is re-read from storage on
 * every call and only the object is reused. A write, a clear, or an edit from
 * another tab all change the string, which misses the cache and produces a new
 * object.
 */
let cachedRawLocation: string | null = null;
let cachedSelection: MarketplaceLocationSelection | null = null;

/** Builds the snapshot for a stored payload, reusing the cached one when unchanged. */
function selectionFor(raw: string, parsed: unknown): MarketplaceLocationSelection | null {
  if (!isSelection(parsed)) return null;

  // Re-validate against the dataset so a removed place cannot stick around.
  const known = findMarketplaceLocation(parsed.location.slug);
  if (!known) return null;

  if (raw === cachedRawLocation) {
    return cachedSelection;
  }

  cachedRawLocation = raw;
  cachedSelection = { location: toPublicLocation(known), source: parsed.source };
  return cachedSelection;
}

export function readMarketplaceLocation(): MarketplaceLocationSelection | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      // A stable `null` needs no cache: `null === null` is already referentially
      // equal, so an empty store cannot itself cause a re-render loop.
      return null;
    }

    const selection = selectionFor(raw, JSON.parse(raw));
    if (!selection) {
      /*
       * Stored but unusable - unparseable, or a place that no longer exists in the
       * dataset. The entry is dropped here rather than in a write, because a
       * remembered slug that 400s on every request is worse than none.
       *
       * The cache is cleared first: the removal below changes what the next read
       * sees, and a stale cached selection must never outlive its stored value.
       */
      cachedRawLocation = null;
      cachedSelection = null;
      storage.removeItem(STORAGE_KEY);
      return null;
    }

    return selection;
  } catch {
    return null;
  }
}

export function writeMarketplaceLocation(
  location: MarketplaceLocationSelection['location'],
  source: MarketplaceLocationSelection['source'],
): void {
  const selection: MarketplaceLocationSelection = { location, source };

  const storage = getStorage();
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }

  /*
   * The cache is dropped rather than updated: the next read must be free to build
   * the snapshot for the new stored string, and keeping the old entry alive would
   * mean a write of a different place could return the previous object's reference
   * if the raw string ever happened to match.
   */
  cachedRawLocation = null;
  cachedSelection = null;

  notify();
}

export function clearMarketplaceLocation(): void {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(STORAGE_KEY);
  }

  cachedRawLocation = null;
  cachedSelection = null;

  notify();
}

/**
 * Projects a dataset entry down to what a client is allowed to see.
 *
 * Coordinates are dropped here rather than at each call site: the picker needs them
 * to match a GPS fix, but they must never be persisted for the customer or sent
 * over the wire, and one projection makes that impossible to forget.
 */
export function toPublicLocation(location: {
  slug: string;
  state: string;
  district: string;
  city: string;
}): MarketplaceLocationSelection['location'] {
  return {
    slug: location.slug,
    state: location.state,
    district: location.district,
    city: location.city,
  };
}

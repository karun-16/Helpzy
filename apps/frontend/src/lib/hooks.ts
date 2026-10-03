import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';

import {
  readAuthSession,
  readPendingAuthRedirect,
  readThemePreference,
  subscribeAuthSession,
  subscribeThemePreference,
  writeThemePreference,
  type AuthSession,
  type SessionRole,
  type ThemePreference,
} from './auth-session';

/**
 * The signed-in session, kept live.
 *
 * `useSyncExternalStore` subscribes to the same storage-backed session the app
 * already uses, so a profile edit re-renders every header, avatar and welcome
 * line without introducing a second copy of the user.
 */
export function useAuthSession(): AuthSession | null {
  const subscribe = useCallback((listener: () => void) => subscribeAuthSession(listener), []);
  const getSnapshot = useCallback(() => readAuthSession(), []);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Server rendering has no storage, so there is no session to hydrate from.
    () => null,
  );
}

/**
 * One answer to "who is using the app right now", for every consumer.
 *
 * The header, the hero, the guards and the booking form used to each derive
 * their own view of the session and could disagree - the screenshot where the
 * header showed a signed-in customer while the hero below still offered "Log in"
 * and "Join as a Professional" was exactly that. Every screen now reads this one
 * object, so a sign-in or sign-out cannot leave half the page stale.
 *
 * `isGuest` is derived rather than passed in, which is why the same screen can
 * render as a public marketplace at `/` and a signed-in marketplace at
 * `/customer` without a prop that can be set to the wrong value.
 */
export interface Viewer {
  /** The signed-in session, or null. */
  session: AuthSession | null;
  isSignedIn: boolean;
  isGuest: boolean;
  role: SessionRole | null;
  name: string;
  avatarUrl: string | null;
  /** Where this viewer belongs after signing in. */
  homeRoute: '/' | '/customer' | '/professional' | '/admin';
  /** True when the session needs a second factor before admin screens open. */
  needsMfa: boolean;
}

export function useViewer(): Viewer {
  const session = useAuthSession();

  return useMemo(() => {
    const role = session?.user.role ?? null;
    const isSignedIn = Boolean(session);
    const homeRoute: Viewer['homeRoute'] =
      role === 'ADMIN' ? '/admin' : role === 'PROFESSIONAL' ? '/professional' : '/';

    return {
      session,
      isSignedIn,
      isGuest: !isSignedIn,
      role,
      name: session?.user.fullName ?? '',
      avatarUrl: session?.user.avatarUrl ?? null,
      homeRoute,
      needsMfa: role === 'ADMIN' && session?.user.mfaVerified !== true,
    };
  }, [session]);
}

/**
 * The destination a guarded screen should return to.
 *
 * Reads the pending redirect the app writes when an unauthenticated visitor asks
 * for something protected, so booking from a professional profile resumes at the
 * booking form rather than dropping the user on the marketplace.
 */
export function usePendingRedirect(): () => string | null {
  return useCallback(() => readPendingAuthRedirect(), []);
}

/**
 * The stored theme preference, kept live.
 *
 * `system` is kept as a distinct value rather than resolved here: resolving it
 * would make "follow my device" indistinguishable from a one-time copy of
 * whatever the device was set to when the user picked it.
 */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const { setColorScheme } = useNativeWindColorScheme();

  const subscribe = useCallback((listener: () => void) => subscribeThemePreference(listener), []);
  const getSnapshot = useCallback(() => readThemePreference(), []);

  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => 'system' as ThemePreference,
  );

  const setPreference = useCallback(
    (next: ThemePreference) => {
      // Persist first, then apply: a failure to store must not leave the UI
      // showing a theme the next launch will not have.
      writeThemePreference(next);
      setColorScheme(next);
    },
    [setColorScheme],
  );

  return [preference, setPreference];
}

/**
 * The initials shown when a user has no photo.
 *
 * Lives here so the header, the profile photo editor and the public professional
 * profile all derive them the same way; three copies of this rule would drift.
 */
export function initialsFor(name: string | null | undefined): string {
  const letters = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** How many times a failing image is retried before the fallback is accepted. */
const IMAGE_LOAD_ATTEMPTS = 2;

export interface LoadableImage {
  /** The URL to render, or `null` when it failed and the caller should fall back. */
  uri: string | null;
  /** Pass to the image's `onError`. */
  onError: () => void;
  /**
   * Put on the image's `key`.
   *
   * A retry re-requests the *same* URL, and neither React Native nor the DOM
   * retries a failed image on their own. Changing the key remounts the element,
   * which is what actually re-issues the request.
   */
  attemptKey: number;
}

/**
 * Renders an image URL, retrying a bounded number of times before giving up.
 *
 * The problem this exists for: an avatar that fails once - a slow connection, a
 * phone leaving wifi mid-load - used to stay on its initials fallback for the
 * rest of the session. Nothing ever re-requested it, and the only way back was a
 * full reload, which reads to a person as "my photo didn't save". A photo that
 * was saved *is* on the server; the screen was simply never asking again.
 *
 * Retries are capped rather than unbounded, because a genuinely missing file
 * must still end up on the initials rather than in an endless request loop.
 *
 * Shared by the header avatar and the profile photo editor on purpose: both fell
 * back to initials on failure, and two copies of that rule is how they end up
 * disagreeing about whether a photo is showing.
 */
export function useLoadableImage(url: string | null): LoadableImage {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /*
   * A different URL is a different image, so it starts from a clean slate. This
   * is what stops a photo that has just been replaced from inheriting the
   * failure verdict of the photo it replaced.
   */
  const [trackedUrl, setTrackedUrl] = useState(url);
  if (trackedUrl !== url) {
    setTrackedUrl(url);
    setFailedUrl(null);
    setAttempt(0);
  }

  const onError = useCallback(() => {
    setAttempt((current) => {
      if (current >= IMAGE_LOAD_ATTEMPTS || !url) {
        setFailedUrl(url);
        return current;
      }
      return current + 1;
    });
  }, [url]);

  return {
    uri: url && failedUrl !== url ? url : null,
    onError,
    attemptKey: attempt,
  };
}

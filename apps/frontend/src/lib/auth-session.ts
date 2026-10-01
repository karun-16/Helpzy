export type SessionRole = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: SessionRole;
  status: string;
  /** Display only. Lets the header show the real photo before a profile fetch. */
  avatarUrl?: string | null;
  mfaVerified?: boolean;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

const STORAGE_KEY = 'helpzy-auth-session';
const THEME_PREFERENCE_KEY = 'helpzy-theme-preference';
const PENDING_AUTH_REDIRECT_KEY = 'helpzy-pending-auth-redirect';

export type ThemePreference = 'system' | 'light' | 'dark';

/* ------------------------------------------------------- session store ---- */

type SessionListener = () => void;

const sessionListeners = new Set<SessionListener>();
const themeListeners = new Set<SessionListener>();

/**
 * Notifies React that the session or theme changed.
 *
 * This is a plain listener set over the *existing* single storage key, not a
 * second store. It exists because `readAuthSession()` is a one-shot read: a
 * screen that renders `readAuthSession().user.fullName` never re-renders when
 * the profile is edited, which is exactly the stale-header bug. Components
 * subscribe through `useAuthSession()` and every write below fans out.
 */
function notify(listeners: Set<SessionListener>): void {
  for (const listener of listeners) listener();
}

export function subscribeAuthSession(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function subscribeThemePreference(listener: SessionListener): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

let cachedRawSession: string | null = null;
let cachedSessionObject: AuthSession | null = null;

export function readAuthSession(): AuthSession | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedRawSession = null;
      cachedSessionObject = null;
      return null;
    }

    if (raw === cachedRawSession) {
      return cachedSessionObject;
    }

    cachedRawSession = raw;
    cachedSessionObject = JSON.parse(raw) as AuthSession;
    return cachedSessionObject;
  } catch {
    cachedRawSession = null;
    cachedSessionObject = null;
    return null;
  }
}

export function writeAuthSession(session: AuthSession): void {
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  notify(sessionListeners);
}

export function clearAuthSession(): void {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(STORAGE_KEY);
  }
  notify(sessionListeners);
}

/**
 * Merges changed identity fields into the stored session.
 *
 * Called after a profile mutation the server has already confirmed, so the
 * header, avatar initials and welcome text show the new value immediately
 * instead of waiting for a re-login. The change is also written to storage, so
 * it is still there after a refresh - the server remains the authority and is
 * re-read on the next profile fetch.
 */
export function patchAuthSessionUser(patch: Partial<AuthUser>): void {
  const current = readAuthSession();
  if (!current) return;

  const next: AuthSession = {
    ...current,
    user: { ...current.user, ...patch },
  };
  writeAuthSession(next);
}

export function readThemePreference(): ThemePreference {
  const value = getStorage()?.getItem(THEME_PREFERENCE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function writeThemePreference(preference: ThemePreference): void {
  getStorage()?.setItem(THEME_PREFERENCE_KEY, preference);
  notify(themeListeners);
}

export function readPendingAuthRedirect(): string | null {
  const value = getStorage()?.getItem(PENDING_AUTH_REDIRECT_KEY);
  if (!value || !value.startsWith('/')) {
    return null;
  }
  return value;
}

export function writePendingAuthRedirect(path: string | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  if (!path) {
    storage.removeItem(PENDING_AUTH_REDIRECT_KEY);
    return;
  }
  storage.setItem(PENDING_AUTH_REDIRECT_KEY, path);
}

export function clearPendingAuthRedirect(): void {
  getStorage()?.removeItem(PENDING_AUTH_REDIRECT_KEY);
}

/**
 * Where each role lands after signing in, and where a role guard sends someone
 * who opens another role's screen.
 *
 * A customer lands on `/`, the shared marketplace, not on a separate customer
 * application: browsing, discovery and booking stay the main surface whether or
 * not the visitor is signed in. `/customer` still renders the same marketplace,
 * so existing links keep working.
 */
export function buildDashboardRoute(role: string): string {
  switch ((role ?? '').toUpperCase()) {
    case 'ADMIN':
      return '/admin';
    case 'PROFESSIONAL':
      return '/professional';
    default:
      return '/';
  }
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

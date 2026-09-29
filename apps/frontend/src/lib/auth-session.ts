export type SessionRole = 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: SessionRole;
  status: string;
  mfaVerified?: boolean;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

const STORAGE_KEY = 'helpzy-auth-session';

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
      return null;
    }
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function writeAuthSession(session: AuthSession): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(STORAGE_KEY);
}

export function buildDashboardRoute(role: string): string {
  switch ((role ?? '').toUpperCase()) {
    case 'ADMIN':
      return '/admin';
    case 'PROFESSIONAL':
      return '/professional';
    default:
      return '/customer';
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

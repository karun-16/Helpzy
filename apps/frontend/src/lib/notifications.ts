import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';

import { api } from './api';
import { readAuthSession } from './auth-session';

/**
 * The signed-in user's unread notification count, shared by every bell.
 *
 * The value is owned by the server (`GET /notifications/unread-count`); this
 * only caches the last known number so the header badge and the notifications
 * screen cannot disagree, and so marking one read updates the badge immediately
 * instead of after a refetch. There is no local counter that can drift upward on
 * its own - `setUnreadCount` is only ever called from a server response.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let cachedUnreadCount: number | null = null;
let cachedForUserId: string | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function readUnreadCount(userId: string | null): number | null {
  if (!userId || cachedForUserId !== userId) return null;
  return cachedUnreadCount;
}

export function setUnreadCount(userId: string | null, count: number | null): void {
  if (!userId) return;
  cachedForUserId = userId;
  cachedUnreadCount = count;
  emit();
}

/**
 * Resets the cache on sign-out so the next account never sees the previous
 * one's badge.
 */
export function resetUnreadCount(): void {
  cachedUnreadCount = null;
  cachedForUserId = null;
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reads the real unread count for the current session user.
 *
 * Returns the count so a caller can use the same value it just wrote to the
 * cache, keeping the badge and the list rendered from one fetch.
 */
export async function refreshUnreadCount(signal?: AbortSignal): Promise<number> {
  const userId = readAuthSession()?.user.id ?? null;
  if (!userId) {
    resetUnreadCount();
    return 0;
  }

  try {
    const data = await api.notifications.unreadCount(signal);
    const count = data.unreadCount ?? 0;
    setUnreadCount(userId, count);
    return count;
  } catch (error) {
    if (isAbort(error)) throw error;
    // A failed count is shown as "unknown" (null), never as a hardcoded zero,
    // so a transient error cannot read as "you have no notifications".
    setUnreadCount(userId, null);
    return 0;
  }
}

/** Subscribes a component to the shared unread count. */
export function useUnreadCount(): { count: number | null; reload: () => void } {
  const userId = readAuthSession()?.user.id ?? null;

  const subscribeStore = useCallback((listener: () => void) => subscribe(listener), []);
  const getSnapshot = useCallback(() => readUnreadCount(userId), [userId]);

  const count = useSyncExternalStore(subscribeStore, getSnapshot, () => null);

  const reload = useCallback(() => {
    void refreshUnreadCount();
  }, []);

  useEffect(() => {
    // A different account must not inherit the previous one's badge.
    if (userId && cachedForUserId !== userId) {
      setUnreadCount(userId, null);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (userId) reload();
    }, [reload, userId]),
  );

  return { count, reload };
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

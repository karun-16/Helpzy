import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  ActionButton,
  EmptyBlock,
  ErrorBlock,
  formatDateTime,
  LoadingBlock,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';
import { readAuthSession } from '@/lib/auth-session';
import { refreshUnreadCount, setUnreadCount } from '@/lib/notifications';
import type { SessionRole } from '@/lib/auth-session';
import type { NotificationDto } from '@helpzy/api-client';

/**
 * The notification inbox, shared by customers and professionals.
 *
 * Both roles have the same notification records and the same mark-read actions -
 * only the route a notification links to differs. That difference is passed in
 * as `homeRoute` / `bookingRoutePrefix` rather than duplicating the screen, so
 * the two roles cannot drift apart.
 *
 * Every item is a real record written by the API when a booking, payment or
 * verification event happened. Nothing is generated locally, and an empty list
 * is shown as an empty list.
 */
export function NotificationInbox({
  role,
  homeRoute,
  bookingRoutePrefix,
  emptyDetail,
}: {
  role: SessionRole;
  homeRoute: '/customer' | '/professional';
  /** e.g. `/customer/bookings` - the notification's booking id is appended. */
  bookingRoutePrefix: string;
  emptyDetail: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    items: NotificationDto[];
    unreadCount: number;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [actionError, setActionError] = useState('');

  const current = result?.request === reload;
  const loadedItems = current ? result.items : null;
  const items = loadedItems ?? [];
  const unreadCount = current ? result.unreadCount : 0;
  const error = current && result.error;

  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.notifications
        .list(controller.signal)
        .then((data) => {
          setResult({
            request: reload,
            items: data.items,
            unreadCount: data.unreadCount,
            error: false,
          });
          // The list already carries the authoritative count, so the header badge
          // is updated from this same response instead of being refetched.
          const userId = readAuthSession()?.user.id ?? null;
          setUnreadCount(userId, data.unreadCount);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult({ request: reload, items: [], unreadCount: 0, error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const openNotification = async (notification: NotificationDto) => {
    setActionError('');
    try {
      // Marked read before navigating so a failed navigation cannot re-show the
      // same item as unread, and so an already-read item is a no-op server-side.
      await api.notifications.markRead(notification.id);
      await refreshUnreadCount().catch(() => 0);
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t mark that notification as read.',
      );
    }
    if (notification.bookingId) {
      router.push(`${bookingRoutePrefix}/${notification.bookingId}`);
    }
    load();
  };

  const markAllRead = async () => {
    setActionError('');
    try {
      await api.notifications.markAllRead();
      await refreshUnreadCount().catch(() => 0);
      load();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t mark everything as read.',
      );
    }
  };

  return (
    <RoleScreen role={role} homeRoute={homeRoute} onHome={() => router.replace(homeRoute)}>
      <ScreenShell>
        <SectionHeading
          title="Notifications"
          onBack={() => router.replace(homeRoute)}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh notifications"
              onPress={load}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                Refresh
              </Text>
            </Pressable>
          }
        />
        <Text className="mt-2 text-base text-secondary">
          {unreadCount === 0
            ? 'You have no unread notifications.'
            : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`}
        </Text>

        {loadedItems === null && !error ? (
          <LoadingBlock label="Loading notifications..." />
        ) : error ? (
          <ErrorBlock onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyBlock title="No notifications yet" detail={emptyDetail} />
        ) : (
          <View className="mt-5 gap-3">
            {items.map((notification) => (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                accessibilityLabel={`${notification.title}. ${
                  notification.readAt ? 'Read' : 'Unread'
                }`}
                onPress={() => openNotification(notification)}
                className={`rounded-xl border bg-surface p-5 ${
                  notification.readAt
                    ? 'border-hairline dark:border-hairline-strong'
                    : 'border-brand-300 dark:border-brand-700'
                }`}
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <Text className="flex-1 text-base font-bold text-primary">
                    {notification.title}
                  </Text>
                  {!notification.readAt ? (
                    <View className="rounded-full bg-brand-100 px-2.5 py-1 dark:bg-brand-950">
                      <Text className="text-xs font-bold uppercase text-brand-800 dark:text-brand-300">
                        New
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text className="mt-1 text-sm leading-5 text-secondary dark:text-primary">
                  {notification.body}
                </Text>
                <Text className="mt-3 text-xs text-muted">
                  {formatDateTime(notification.createdAt)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {items.length > 0 ? (
          <Panel
            title="Notification settings"
            subtitle="Marking everything read is a real update on our servers and cannot be undone."
          >
            <ActionButton label="Mark all as read" onPress={markAllRead} tone="subtle" />
            {actionError ? (
              <Text
                accessibilityRole="alert"
                className="mt-3 text-sm text-rose-800 dark:text-rose-300"
              >
                {actionError}
              </Text>
            ) : null}
          </Panel>
        ) : null}
      </ScreenShell>
    </RoleScreen>
  );
}

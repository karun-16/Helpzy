import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { formatDateTime } from '@/components/marketplace-ui';
import { api } from '@/lib/api';
import type { BookingTimelineEntryDto } from '@helpzy/validation';

/**
 * The booking's real status history.
 *
 * Every row is a `booking_status_history` record written in the same transaction
 * as the status change it describes, so this list is exactly what happened. No
 * step is inferred from the current status, and a booking with no recorded
 * history renders an honest empty state rather than a fabricated starting point.
 */
export function BookingTimelinePanel({
  bookingId,
  load,
}: {
  bookingId: string;
  load: (signal: AbortSignal) => Promise<BookingTimelineEntryDto[]>;
}) {
  const [entries, setEntries] = useState<BookingTimelineEntryDto[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    load(controller.signal)
      .then((loaded) => {
        if (active) setEntries(loaded);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [bookingId, load]);

  return (
    <View className="mt-5 rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5">
      <Text className="text-base font-bold text-primary">Progress</Text>
      <Text className="mt-1 text-sm text-secondary">
        Every recorded step of this booking, in the order it happened.
      </Text>

      {unavailable ? (
        <Text className="mt-4 text-sm text-secondary">
          The history for this booking is not available right now.
        </Text>
      ) : entries === null ? (
        <View className="mt-4 min-h-16 flex-row items-center gap-3">
          <ActivityIndicator color="#047857" />
          <Text className="text-sm text-secondary">Loading history...</Text>
        </View>
      ) : entries.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">
          No steps have been recorded for this booking yet.
        </Text>
      ) : (
        <View className="mt-4">
          {entries.map((entry, index) => {
            const isLast = index === entries.length - 1;
            return (
              <View key={entry.id} className="flex-row gap-3">
                <View className="items-center">
                  <View
                    className={`h-3 w-3 rounded-full ${entry.isOwnAction ? 'bg-brand-700' : 'bg-slate-400'}`}
                  />
                  {!isLast ? (
                    <View className="w-0.5 flex-1 bg-surface-sunken dark:bg-slate-700" />
                  ) : null}
                </View>
                <View className={isLast ? 'pb-0' : 'pb-6'}>
                  <Text className="text-sm font-semibold text-primary">
                    {friendlyStatus(entry.toStatus)}
                  </Text>
                  <Text className="mt-0.5 text-sm text-secondary">
                    {entry.fromStatus
                      ? `from ${friendlyStatus(entry.fromStatus)} · `
                      : 'booking created · '}
                    {entry.isOwnAction ? 'done by you' : `by ${entry.actorName}`}
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted">
                    {formatDateTime(entry.createdAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** The customer's own booking history. */
export function CustomerBookingTimeline({ bookingId }: { bookingId: string }) {
  return (
    <BookingTimelinePanel
      bookingId={bookingId}
      load={(signal) => api.customerBookings.timeline(bookingId, signal)}
    />
  );
}

/** The assigned professional's view of the same recorded history. */
export function ProfessionalBookingTimeline({ bookingId }: { bookingId: string }) {
  return (
    <BookingTimelinePanel
      bookingId={bookingId}
      load={(signal) => api.professionalBookings.timeline(bookingId, signal)}
    />
  );
}

function friendlyStatus(status: string) {
  return status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

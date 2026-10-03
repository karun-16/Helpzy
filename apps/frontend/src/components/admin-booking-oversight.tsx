import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BOOKING_STATUSES, PAYMENT_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  formatDateTime,
} from '@/components/marketplace-ui';
import { StatusBadge, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Booking = Awaited<ReturnType<typeof api.admin.bookings>>[number];
type Detail = Awaited<ReturnType<typeof api.admin.bookingDetail>>;

/** Statuses an admin can force a booking into. */
const OVERRIDE_TARGETS = [
  BOOKING_STATUSES.ACCEPTED,
  BOOKING_STATUSES.IN_PROGRESS,
  BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.CLOSED,
  BOOKING_STATUSES.CANCELLED,
] as const;

/** The reason must be a sentence, not a shrug; the server enforces the same floor. */
const REASON_MIN = 10;

/**
 * Administrative oversight of a single booking.
 *
 * Two actions, both irreversible in effect and both requiring a written reason:
 * forcing a status the normal flow would not reach, and refunding a payment. The
 * reason is required in the UI rather than merely validated on submit, because
 * the whole point of this panel is that a later reader can tell an
 * administrative decision apart from a bug.
 *
 * The detail view is fetched on demand: it pulls the chat, the address, the
 * timeline and the dispute, which is too much to load for every row in a list.
 */
export function AdminBookingOversight() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [target, setTarget] = useState<string>(BOOKING_STATUSES.CLOSED);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const listSeq = useRef(0);

  const load = useCallback(() => {
    const seq = listSeq.current + 1;
    listSeq.current = seq;
    api.admin
      .bookings({})
      .then((rows) => {
        if (listSeq.current === seq) setBookings(rows);
      })
      .catch(() => {
        if (listSeq.current === seq) setError('Could not load bookings.');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!openId) return;
    api.admin
      .bookingDetail(openId)
      .then(setDetail)
      .catch(() => setError('Could not load that booking.'));
  }, [openId]);

  const term = search.trim().toLocaleLowerCase();
  const rows = (bookings ?? []).filter((booking) => {
    const statusMatches = statusFilter === 'ALL' || booking.status === statusFilter;
    const searchMatches =
      !term ||
      [booking.reference, booking.serviceTitle, booking.customerName, booking.professionalName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(term));
    return statusMatches && searchMatches;
  });

  const reasonValid = reason.trim().length >= REASON_MIN;

  const closePanel = () => {
    setOpenId(null);
    setReason('');
    setTarget(BOOKING_STATUSES.CLOSED);
    setError('');
    setNotice('');
  };

  const run = async (bookingId: string, action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(bookingId);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      setReason('');
      // The detail response is already the post-change state, so the open row
      // is refreshed by refetching rather than being patched locally.
      load();
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t complete that change.',
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="mt-8">
      <Text className="text-xl font-bold text-primary">Booking oversight</Text>
      <Text className="mt-1 text-sm text-secondary">
        Move a booking to a status it could not reach on its own, or refund a payment. Both need a
        reason, both notify the customer and the professional, and both are recorded in the audit
        log.
      </Text>

      <TextInput
        accessibilityLabel="Search bookings"
        value={search}
        onChangeText={setSearch}
        placeholder="Search by reference, service, customer or professional"
        placeholderTextColor="#94a3b8"
        className="mt-3 min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
      />

      <View className="mt-3 flex-row flex-wrap gap-2">
        {['ALL', ...OVERRIDE_TARGETS].map((option) => {
          const selected = option === statusFilter;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Show ${option.replaceAll('_', ' ')} bookings`}
              accessibilityState={{ selected }}
              onPress={() => setStatusFilter(option)}
              className={`min-h-9 justify-center rounded-lg border px-3 ${
                selected
                  ? 'border-action-text bg-surface-muted'
                  : 'border-hairline-strong bg-surface'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-action-text' : 'text-secondary'
                }`}
              >
                {option === 'ALL' ? 'All' : option.replaceAll('_', ' ').toLocaleLowerCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {bookings === null ? (
        <LoadingBlock label="Loading bookings..." />
      ) : rows.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">No bookings match this view.</Text>
      ) : (
        <View className="mt-4 gap-3">
          {rows.map((booking) => {
            const isOpen = openId === booking.id;
            const paid = booking.paymentStatus === PAYMENT_STATUSES.PAID;

            return (
              <View
                key={booking.id}
                className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="font-bold text-primary">{booking.serviceTitle}</Text>
                    <Text className="mt-1 text-sm text-secondary">
                      {booking.reference} · {booking.customerName} with{' '}
                      {booking.businessName ?? booking.professionalName}
                    </Text>
                    <Text className="mt-1 text-xs text-tertiary">
                      {formatDateTime(booking.scheduledStart)}
                    </Text>
                  </View>
                  <View className="gap-2">
                    <StatusPill label={booking.status.replaceAll('_', ' ')} tone="neutral" />
                    <StatusBadge
                      label={`Payment: ${booking.paymentStatus ?? 'none'}`}
                      tone={paid ? 'success' : 'neutral'}
                    />
                  </View>
                </View>

                {isOpen ? (
                  <View className="mt-3 gap-3">
                    {detail?.id === booking.id ? (
                      <BookingFacts detail={detail} />
                    ) : (
                      <LoadingBlock label="Loading the full booking..." />
                    )}

                    <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                      Reason
                    </Text>
                    <TextInput
                      accessibilityLabel="Reason for this change"
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Both parties will read this, and it goes in the audit log."
                      placeholderTextColor="#94a3b8"
                      multiline
                      className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                    />
                    {reason.length > 0 && !reasonValid ? (
                      <Text className="text-xs text-error">
                        Give at least {REASON_MIN} characters so the record explains itself later.
                      </Text>
                    ) : null}

                    <View className="gap-2">
                      <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                        Move to
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {OVERRIDE_TARGETS.map((option) => {
                          const selected = option === target;
                          const isCurrent = option === detail?.status;
                          return (
                            <Pressable
                              key={option}
                              accessibilityRole="button"
                              accessibilityLabel={`Move to ${option.replaceAll('_', ' ')}`}
                              accessibilityState={{ selected, disabled: isCurrent }}
                              disabled={isCurrent}
                              onPress={() => setTarget(option)}
                              className={`min-h-9 justify-center rounded-lg border px-3 ${
                                isCurrent
                                  ? 'border-hairline bg-surface-muted'
                                  : selected
                                    ? 'border-action-text bg-surface-muted'
                                    : 'border-hairline-strong bg-surface'
                              }`}
                            >
                              <Text
                                className={`text-sm font-semibold ${
                                  isCurrent
                                    ? 'text-tertiary'
                                    : selected
                                      ? 'text-action-text'
                                      : 'text-secondary'
                                }`}
                              >
                                {option.replaceAll('_', ' ').toLocaleLowerCase()}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <View className="flex-row flex-wrap gap-3">
                      <ActionButton
                        label="Apply status change"
                        onPress={() =>
                          run(
                            booking.id,
                            () =>
                              api.admin.overrideBookingStatus(booking.id, {
                                status: target as (typeof OVERRIDE_TARGETS)[number],
                                reason: reason.trim(),
                              }),
                            `Booking ${booking.reference} moved to ${target.replaceAll('_', ' ').toLocaleLowerCase()}.`,
                          )
                        }
                        busy={busy === booking.id}
                        disabled={busy !== null || !reasonValid || target === detail?.status}
                      />
                      {paid ? (
                        <ActionButton
                          label="Refund payment"
                          tone="subtle"
                          onPress={() =>
                            run(
                              booking.id,
                              () => api.admin.refundBooking(booking.id, { reason: reason.trim() }),
                              `Booking ${booking.reference} refunded and closed.`,
                            )
                          }
                          busy={busy === booking.id}
                          disabled={busy !== null || !reasonValid}
                        />
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close booking oversight"
                        onPress={closePanel}
                        disabled={busy !== null}
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-sm font-semibold text-secondary">Close</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Oversee booking ${booking.reference}`}
                    disabled={busy !== null}
                    onPress={() => {
                      setOpenId(booking.id);
                      setDetail(null);
                      setReason('');
                      setTarget(BOOKING_STATUSES.CLOSED);
                      setError('');
                      setNotice('');
                    }}
                    className="mt-3 min-h-9 justify-center"
                  >
                    <Text className="text-sm font-semibold text-action-text">Open and oversee</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </View>
  );
}

/** The assembled detail: parties, money, chat, dispute and timeline. */
function BookingFacts({ detail }: { detail: Detail }) {
  return (
    <View className="gap-3 rounded-lg border border-hairline bg-surface-muted p-3">
      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-wide text-secondary">Parties</Text>
        <Text className="text-sm text-primary">
          Customer: {detail.customer.fullName} · {detail.customer.phone}
        </Text>
        <Text className="text-sm text-primary">
          Professional: {detail.professional.fullName} · {detail.professional.phone}
        </Text>
        {detail.address ? (
          <Text className="text-sm text-primary">
            Address: {detail.address.line1}, {detail.address.city} {detail.address.postalCode}
          </Text>
        ) : null}
      </View>

      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-wide text-secondary">Money</Text>
        <Text className="text-sm text-primary">
          {detail.currency} {detail.priceAmount.toLocaleString('en-IN')}
        </Text>
        {detail.payment ? (
          <Text className="text-sm text-primary">
            Payment: {detail.payment.status.replaceAll('_', ' ').toLocaleLowerCase()} ·{' '}
            {detail.payment.method.replaceAll('_', ' ').toLocaleLowerCase()}
          </Text>
        ) : (
          <Text className="text-sm text-primary">Payment: none taken</Text>
        )}
      </View>

      {detail.dispute ? (
        <View className="gap-1">
          <Text className="text-xs font-bold uppercase tracking-wide text-secondary">Dispute</Text>
          <Text className="text-sm text-primary">
            {detail.dispute.category.replaceAll('_', ' ').toLocaleLowerCase()} ·{' '}
            {detail.dispute.status.replaceAll('_', ' ').toLocaleLowerCase()}
          </Text>
          <Text className="text-sm text-secondary">{detail.dispute.reason}</Text>
        </View>
      ) : null}

      {detail.messages.length > 0 ? (
        <View className="gap-1">
          <Text className="text-xs font-bold uppercase tracking-wide text-secondary">Messages</Text>
          {detail.messages.slice(-4).map((message) => (
            <Text key={message.id} className="text-sm text-primary">
              {message.sender.fullName}: {message.body}
            </Text>
          ))}
        </View>
      ) : null}

      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-wide text-secondary">Timeline</Text>
        {detail.timeline.map((entry) => (
          <Text key={entry.id} className="text-sm text-primary">
            {entry.fromStatus ? `${entry.fromStatus.replaceAll('_', ' ')} → ` : ''}
            {entry.toStatus.replaceAll('_', ' ')} · {entry.actor.fullName}
            {entry.isOverride ? ' · admin override' : ''} · {formatDateTime(entry.createdAt)}
          </Text>
        ))}
      </View>
    </View>
  );
}

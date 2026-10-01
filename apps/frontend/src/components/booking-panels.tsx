import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  DetailRow,
  formatDateTime,
  formatMoney,
  InlineError,
  InlineSuccess,
  Panel,
} from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';
import type { BookingMessageDto } from '@helpzy/validation';

/**
 * The booking-scoped conversation.
 *
 * Messages exist only inside a booking and only for its two participants, so
 * there is no screen here for a general inbox and no way to start a conversation
 * with a stranger.
 */
export function BookingChatPanel({
  bookingId,
  readOnly = false,
  readOnlyReason,
}: {
  bookingId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  const [messages, setMessages] = useState<BookingMessageDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadedMessages = messages ?? [];

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = () => {
      api.chat
        .list(bookingId, controller.signal)
        .then((data) => {
          if (!active) return;
          setMessages(data);
          setFailed(false);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [bookingId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      setMessages(await api.chat.send(bookingId, body));
      setDraft('');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t send that message. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Panel
      title="Messages"
      subtitle="This conversation is private to you and the assigned professional."
    >
      {messages === null && !failed ? (
        <View className="min-h-20 flex-row items-center justify-center gap-3">
          <ActivityIndicator color="#047857" />
          <Text className="text-sm text-secondary">Loading messages...</Text>
        </View>
      ) : failed ? (
        <InlineError message="We couldn’t load these messages." />
      ) : loadedMessages.length === 0 ? (
        <Text className="text-sm text-secondary">
          No messages yet. Use this space for access details and arrival timing.
        </Text>
      ) : (
        <View className="gap-3">
          {loadedMessages.map((message) => (
            <View
              key={message.id}
              className={`rounded-lg px-4 py-3 ${
                message.isOwn
                  ? 'self-end bg-brand-100 dark:bg-brand-950'
                  : 'self-start bg-surface-muted dark:bg-slate-800'
              }`}
            >
              <Text className="text-xs font-semibold text-secondary">{message.senderName}</Text>
              <Text className="mt-1 text-sm leading-5 text-primary">{message.body}</Text>
              <Text className="mt-1 text-xs text-muted">{formatDateTime(message.createdAt)}</Text>
            </View>
          ))}
        </View>
      )}

      {readOnly ? (
        <Text className="mt-4 rounded-lg bg-slate-50 dark:bg-canvas px-4 py-3 text-sm text-secondary dark:text-primary">
          {readOnlyReason ?? 'This conversation is closed.'}
        </Text>
      ) : (
        <View className="mt-4 flex-row items-end gap-2">
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message..."
            placeholderTextColor="#94a3b8"
            multiline
            className="min-h-11 flex-1 rounded-lg border border-hairline-strong px-3 py-2 text-base text-primary"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ busy: sending, disabled: sending || draft.trim().length === 0 }}
            disabled={sending || draft.trim().length === 0}
            onPress={send}
            className={`min-h-11 justify-center rounded-lg px-4 ${
              sending || draft.trim().length === 0
                ? 'bg-brand-300 dark:bg-brand-900'
                : 'bg-brand-800'
            }`}
          >
            {sending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text className="font-semibold text-white">Send</Text>
            )}
          </Pressable>
        </View>
      )}
      <InlineError message={error} />
    </Panel>
  );
}

/**
 * The customer's payment view for one booking.
 *
 * The amount comes from the agreed service price on the server. The method
 * buttons come from `capabilities`, so an unconfigured gateway is never shown as
 * an option.
 */
export function BookingPaymentPanel({ bookingId }: { bookingId: string }) {
  const [payment, setPayment] = useState<Awaited<
    ReturnType<typeof api.payments.getForBooking>
  > | null>(null);
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof api.payments.capabilities>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState<'ONLINE' | 'DIRECT' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api.payments.getForBooking(bookingId), api.payments.capabilities()])
      .then(([loaded, caps]) => {
        if (!active) return;
        setPayment(loaded);
        setCapabilities(caps);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [bookingId]);

  const start = async (method: 'ONLINE' | 'DIRECT') => {
    setStarting(method);
    setError('');
    setNotice('');
    try {
      const updated = await api.payments.start(bookingId, method);
      setPayment(updated);
      setNotice(
        updated.status === 'PAID'
          ? 'This payment is recorded as paid.'
          : 'This payment has been started. It is not paid yet.',
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'We couldn’t start that payment.',
      );
    } finally {
      setStarting(null);
    }
  };

  if (failed) return <InlineError message="We couldn’t load the payment for this booking." />;

  if (payment === null) {
    return (
      <Panel title="Payment">
        <Text className="text-sm text-secondary">Loading payment details...</Text>
      </Panel>
    );
  }

  return (
    <Panel
      title="Payment"
      subtitle="Amounts come from the agreed service price. Nothing here can be edited by hand."
    >
      <View className="gap-1">
        <DetailRow label="Amount" value={formatMoney(payment.amount, payment.currency)} />
        <DetailRow label="Status" value={friendlyPaymentStatus(payment.status)} />
        <DetailRow
          label="Method"
          value={payment.method ? friendlyMethod(payment.method) : 'Not chosen yet'}
        />
        <DetailRow label="Provider" value={payment.provider ?? 'None'} />
        {payment.failureReason ? (
          <DetailRow label="Reported problem" value={payment.failureReason} />
        ) : null}
        <DetailRow
          label="Paid at"
          value={payment.paidAt ? formatDateTime(payment.paidAt) : 'Not paid'}
        />
      </View>

      {payment.status === 'PAID' ? (
        <InlineSuccess message="This booking has been paid." />
      ) : capabilities?.onlineAvailable ? (
        <ActionButton
          label={`Pay ${formatMoney(payment.amount, payment.currency)} online`}
          onPress={() => start('ONLINE')}
          busy={starting !== null}
        />
      ) : (
        <Text className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Online payment is not available in this deployment, so no amount has been charged. You can
          pay the professional directly instead.
        </Text>
      )}

      {payment.status !== 'PAID' && capabilities?.directAvailable ? (
        <ActionButton
          label="I will pay the professional directly"
          tone="subtle"
          onPress={() => start('DIRECT')}
          busy={starting !== null}
        />
      ) : null}

      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </Panel>
  );
}

/** Read-only professional payment status with confirmation for direct receipt. */
export function ProfessionalPaymentPanel({ bookingId }: { bookingId: string }) {
  const [payment, setPayment] = useState<Awaited<
    ReturnType<typeof api.payments.getAsProfessional>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    api.payments
      .getAsProfessional(bookingId)
      .then((loaded) => {
        if (!active) return;
        setPayment(loaded);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [bookingId]);

  const recordReceipt = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.payments.recordDirect(bookingId);
      setPayment(updated);
      setNotice('Direct payment receipt recorded.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t record the payment receipt.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <InlineError message="No payment record is available for this booking." />;
  if (!payment) {
    return (
      <Panel title="Payment">
        <Text className="text-sm text-secondary">Loading payment details...</Text>
      </Panel>
    );
  }

  return (
    <Panel title="Payment" subtitle="Payment status is controlled by the server.">
      <View className="gap-1">
        <DetailRow label="Amount" value={formatMoney(payment.amount, payment.currency)} />
        <DetailRow
          label="Method"
          value={payment.method ? friendlyMethod(payment.method) : 'Not chosen'}
        />
        <DetailRow label="Status" value={friendlyPaymentStatus(payment.status)} />
        <DetailRow
          label="Paid at"
          value={payment.paidAt ? formatDateTime(payment.paidAt) : 'Not paid'}
        />
      </View>
      {payment.method === 'DIRECT' && payment.status !== 'PAID' ? (
        <ActionButton label="Confirm direct payment received" onPress={recordReceipt} busy={busy} />
      ) : payment.method === 'ONLINE' && payment.status !== 'PAID' ? (
        <Text className="mt-3 text-sm leading-5 text-secondary">
          Online payment is awaiting provider confirmation. You cannot mark it paid here.
        </Text>
      ) : null}
      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </Panel>
  );
}

/**
 * Where the assigned professional is, if they have chosen to share.
 *
 * Every unavailable state has its own message. No placeholder map, no straight
 * line, no distance guess: when the API says there is no fix, that is what the
 * customer reads.
 */
export function ProfessionalLocationPanel({ bookingId }: { bookingId: string }) {
  const [location, setLocation] = useState<Awaited<
    ReturnType<typeof api.location.forBooking>
  > | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api.location
      .forBooking(bookingId)
      .then((loaded) => {
        if (!active) return;
        setLocation(loaded);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [bookingId]);

  if (failed) {
    return (
      <Panel title="Professional location">
        <Text className="text-sm text-secondary">
          Live location is not available for this booking.
        </Text>
      </Panel>
    );
  }

  if (location === null) {
    return (
      <Panel title="Professional location">
        <Text className="text-sm text-secondary">Checking location sharing...</Text>
      </Panel>
    );
  }

  return (
    <Panel
      title="Professional location"
      subtitle={`${location.professionalName} · ${location.bookingReference}`}
    >
      {location.available ? (
        <View className="gap-1">
          <DetailRow label="Latitude" value={location.latitude.toFixed(6)} />
          <DetailRow label="Longitude" value={location.longitude.toFixed(6)} />
          <DetailRow label="Last reported" value={formatDateTime(location.updatedAt)} />
          <DetailRow
            label="Freshness"
            value={location.isStale ? 'This fix is old, so it may not be current' : 'Current'}
          />
          {location.isStale ? (
            <Text className="mt-2 text-sm text-amber-900 dark:text-amber-200">
              The professional&apos;s device has not reported recently. Treat this position as
              approximate.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text className="text-sm leading-5 text-secondary dark:text-primary">
          {explainUnavailable(location.reason)}
        </Text>
      )}
    </Panel>
  );
}

function explainUnavailable(
  reason: 'SHARING_DISABLED' | 'BOOKING_NOT_ACTIVE' | 'NO_REPORTED_POSITION',
) {
  switch (reason) {
    case 'SHARING_DISABLED':
      return 'This professional has not turned on location sharing, so no position is available for this booking.';
    case 'BOOKING_NOT_ACTIVE':
      return 'Location is only shared while this booking is on the way or in progress.';
    case 'NO_REPORTED_POSITION':
      return 'Location sharing is on, but this professional’s device has not reported a position yet.';
  }
}

/** Leaves a review for a booking the customer confirmed. */
export function LeaveReviewPanel({
  bookingId,
  canReview,
  existingReviewId,
}: {
  bookingId: string;
  canReview: boolean;
  existingReviewId: string | null;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await api.reviews.create(bookingId, {
        rating,
        comment: comment.trim() === '' ? null : comment.trim(),
      });
      setDone(true);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t save your review. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (existingReviewId || done) {
    return (
      <Panel title="Your review" subtitle="Reviews are published against a real completed booking.">
        <InlineSuccess message="Thank you — your review has been recorded." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Rate this service"
      subtitle="Only customers whose booking reached confirmation can leave a review."
    >
      {!canReview ? (
        <Text className="text-sm text-secondary">
          Confirm this booking as complete before leaving a review.
        </Text>
      ) : (
        <View>
          <View className="flex-row gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                accessibilityState={{ selected: rating === value }}
                onPress={() => setRating(value)}
                className={`min-h-11 w-11 items-center justify-center rounded-lg border ${
                  rating === value
                    ? 'border-amber-500 bg-amber-100'
                    : 'border-hairline-strong dark:border-hairline-strong'
                }`}
              >
                <Text className="text-lg font-bold text-amber-700 dark:text-amber-400">
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Review comment"
            value={comment}
            onChangeText={setComment}
            placeholder="Tell others about the work (optional)"
            placeholderTextColor="#94a3b8"
            multiline
            className="mt-4 min-h-24 rounded-lg border border-hairline-strong px-3 py-2 align-top text-base text-primary"
          />
          <ActionButton label="Submit review" onPress={submit} busy={saving} />
          <InlineError message={error} />
        </View>
      )}
    </Panel>
  );
}

function friendlyPaymentStatus(status: string) {
  return status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function friendlyMethod(method: string) {
  return method === 'ONLINE' ? 'Paid online' : 'Paid directly to the professional';
}

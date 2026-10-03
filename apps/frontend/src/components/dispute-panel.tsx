import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { DISPUTE_CATEGORIES, TERMINAL_DISPUTE_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  formatDateTime,
} from '@/components/marketplace-ui';
import { StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Dispute = NonNullable<Awaited<ReturnType<typeof api.disputes.forBooking>>>;

const CATEGORY_LABELS: Record<string, string> = {
  SERVICE_NOT_AS_DESCRIBED: 'Work not as described',
  NO_SHOW: 'Nobody turned up',
  QUALITY_ISSUE: 'Poor quality',
  PROPERTY_DAMAGE: 'Damage to my property',
  PAYMENT_ISSUE: 'Payment problem',
  UNSAFE_BEHAVIOUR: 'Unsafe behaviour',
  OTHER: 'Something else',
};

/**
 * A dispute on one booking, shared by the customer and the professional.
 *
 * Raising a dispute **suspends** the booking, so the copy says so plainly: the
 * usual next steps stop applying until HELPZY closes the dispute. Both parties
 * see the same history and both can add to it, because a dispute resolved from
 * one side's version of events is not a resolution.
 */
export function DisputePanel({ bookingId }: { bookingId: string }) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [category, setCategory] = useState<string>(DISPUTE_CATEGORIES.SERVICE_NOT_AS_DESCRIBED);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'open' | 'message' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /**
   * A 404 here is the normal case, not a failure: most bookings have no dispute
   * and the panel should simply offer to raise one.
   */
  const load = useCallback(() => {
    api.disputes
      .forBooking(bookingId)
      .then((result) => {
        setDispute(result);
        setMissing(false);
      })
      .catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 404) {
          setDispute(null);
          setMissing(true);
          return;
        }
        setError('Could not load the dispute for this booking.');
      })
      .finally(() => setLoading(false));
  }, [bookingId]);

  useEffect(load, [load]);

  const reasonValid = reason.trim().length >= 20;
  const messageValid = message.trim().length > 0;

  const open = async () => {
    if (busy) return;
    setBusy('open');
    setError('');
    setNotice('');
    try {
      const created = await api.disputes.open(bookingId, {
        category: category as never,
        reason: reason.trim(),
      });
      setDispute(created);
      setOpenForm(false);
      setMissing(false);
      setReason('');
      setNotice('Dispute raised. The booking is paused until HELPZY reviews it.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not raise the dispute.',
      );
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!dispute || busy) return;
    setBusy('message');
    setError('');
    setNotice('');
    try {
      const updated = await api.disputes.send(dispute.id, message.trim());
      setDispute(updated);
      setMessage('');
      setNotice('Your message was added to the dispute.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not send your message.',
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <View className="mt-4">
        <Text className="text-sm text-secondary">Checking for a dispute...</Text>
      </View>
    );
  }

  if (!dispute) {
    if (!missing) return null;

    return (
      <View className="mt-6 rounded-xl border border-hairline bg-surface p-5 dark:border-hairline-strong">
        <Text className="text-base font-bold text-primary">Something not right?</Text>
        <Text className="mt-1 text-sm text-secondary">
          Raise a dispute and HELPZY will look into it. The booking pauses until the dispute is
          closed, and the other party will be told so they can answer.
        </Text>

        {!openForm ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Raise a dispute about this booking"
            onPress={() => {
              setOpenForm(true);
              setError('');
              setNotice('');
            }}
            className="mt-3 self-start"
          >
            <Text className="text-sm font-semibold text-action-text">Raise a dispute</Text>
          </Pressable>
        ) : (
          <View className="mt-4 gap-3">
            <View className="gap-2">
              <Text className="text-sm font-semibold text-primary">What went wrong?</Text>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => {
                const selected = value === category;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                    onPress={() => setCategory(value)}
                    className={`min-h-11 justify-center rounded-lg border px-3 ${
                      selected
                        ? 'border-action-text bg-surface-muted'
                        : 'border-hairline-strong bg-surface'
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        selected ? 'font-semibold text-action-text' : 'text-secondary'
                      }`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              accessibilityLabel="Describe what happened"
              value={reason}
              onChangeText={setReason}
              placeholder="Describe what happened, in as much detail as you can."
              placeholderTextColor="#94a3b8"
              multiline
              className="min-h-24 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
            />
            <Text className="text-xs text-secondary">
              {reason.trim().length < 20
                ? `At least 20 characters so the other party can respond properly (${
                    reason.trim().length
                  } so far).`
                : `${reason.trim().length} characters.`}
            </Text>

            <View className="flex-row gap-3">
              <ActionButton
                label="Submit dispute"
                onPress={open}
                busy={busy === 'open'}
                disabled={busy !== null || !reasonValid}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={() => setOpenForm(false)}
                disabled={busy !== null}
                className="min-h-11 justify-center px-2"
              >
                <Text className="text-sm font-semibold text-secondary">Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}

        <InlineError message={error} />
        <InlineSuccess message={notice} />
      </View>
    );
  }

  const closed = (TERMINAL_DISPUTE_STATUSES as readonly string[]).includes(dispute.status);

  return (
    <View className="mt-6 rounded-xl border border-hairline bg-surface p-5 dark:border-hairline-strong">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-48 flex-1">
          <Text className="text-base font-bold text-primary">Dispute</Text>
          <Text className="mt-1 text-sm text-secondary">
            {CATEGORY_LABELS[dispute.category] ?? dispute.category} · booking{' '}
            {dispute.bookingReference}
          </Text>
        </View>
        <StatusBadge
          label={closed ? 'Closed' : dispute.status === 'UNDER_REVIEW' ? 'Under review' : 'Open'}
          tone={closed ? 'neutral' : 'pending'}
        />
      </View>

      <Text className="mt-3 text-sm text-secondary">
        This booking is paused while the dispute is open.
      </Text>

      <ScrollView className="mt-4 max-h-96" nestedScrollEnabled>
        <View className="gap-3">
          {dispute.events.map((event) => (
            <View key={event.id} className="rounded-lg border border-hairline bg-surface-muted p-3">
              <View className="flex-row flex-wrap items-baseline justify-between gap-2">
                <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                  {event.type === 'OPENED'
                    ? 'Dispute raised'
                    : event.type === 'MESSAGE'
                      ? 'Message'
                      : event.type === 'RESOLUTION'
                        ? 'HELPZY decision'
                        : 'Status change'}
                </Text>
                <Text className="text-xs text-secondary">{formatDateTime(event.createdAt)}</Text>
              </View>
              <Text className="mt-1 text-xs text-secondary">{event.actor.fullName}</Text>
              {event.body ? <Text className="mt-2 text-sm text-primary">{event.body}</Text> : null}
              {event.fromStatus && event.toStatus ? (
                <Text className="mt-2 text-xs text-secondary">
                  Status moved from {event.fromStatus} to {event.toStatus}.
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>

      {closed ? (
        <Text className="mt-4 text-sm text-secondary">
          This dispute is closed, so the booking has resumed. The history above stays here for
          reference.
        </Text>
      ) : (
        <View className="mt-4 gap-3">
          <TextInput
            accessibilityLabel="Add to the dispute"
            value={message}
            onChangeText={setMessage}
            placeholder="Add your side of the story"
            placeholderTextColor="#94a3b8"
            multiline
            className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
          />
          <ActionButton
            label="Send message"
            onPress={send}
            busy={busy === 'message'}
            disabled={busy !== null || !messageValid}
          />
        </View>
      )}

      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </View>
  );
}

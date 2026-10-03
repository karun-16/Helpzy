import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { ApiError, api } from '@/lib/api';

type RescheduleState = NonNullable<Awaited<ReturnType<typeof api.reschedule.state>>>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * Rescheduling for one booking, shared by the customer and the
 * professional.
 *
 * The server resolves which party the viewer is and what they may do, so
 * the panel never re-derives the rule: it renders what `state` says is
 * allowed and hides the rest. A proposal never moves the appointment
 * until the other party accepts it, so the current time stays visible
 * while a request is pending.
 */
export function ReschedulePanel({ bookingId }: { bookingId: string }) {
  const [state, setState] = useState<RescheduleState | null>(null);
  const [error, setError] = useState('');
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposedStart, setProposedStart] = useState('');
  const [reason, setReason] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState<'propose' | 'accept' | 'reject' | 'withdraw' | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(() => {
    api.reschedule
      .state(bookingId)
      .then((result) => {
        setState(result);
        setError('');
      })
      .catch(() => {
        // A booking with no reschedule activity is the normal case; the
        // panel simply offers to propose a new time.
        setState(null);
      });
  }, [bookingId]);

  useEffect(load, [load]);

  const pending = state?.pending ?? null;
  const canRequest = state?.canRequest ?? false;
  const canDecide = state?.canDecide ?? false;
  const canWithdraw = state?.canWithdraw ?? false;

  const proposeValid =
    proposedStart.trim().length > 0 && !Number.isNaN(new Date(proposedStart).getTime());
  const rejectValid = decisionNote.trim().length > 0;

  const reload = async () => {
    await load();
  };

  const propose = async () => {
    if (busy || !proposeValid) return;
    setBusy('propose');
    setActionError('');
    try {
      await api.reschedule.request(bookingId, {
        proposedStart: new Date(proposedStart).toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setProposeOpen(false);
      setProposedStart('');
      setReason('');
      await reload();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t request a new time. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: 'ACCEPTED' | 'REJECTED') => {
    if (busy) return;
    if (decision === 'REJECTED' && !rejectValid) return;
    setBusy(decision === 'ACCEPTED' ? 'accept' : 'reject');
    setActionError('');
    try {
      await api.reschedule.decide(bookingId, {
        decision,
        ...(decision === 'REJECTED' ? { decisionNote: decisionNote.trim() } : {}),
      });
      setDecisionNote('');
      await reload();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t respond to the request. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    if (busy) return;
    setBusy('withdraw');
    setActionError('');
    try {
      await api.reschedule.withdraw(bookingId);
      await reload();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t withdraw the request. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="mt-5 border-t border-hairline dark:border-hairline-strong pt-5">
      <Text className="text-sm font-semibold text-primary">Reschedule</Text>

      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-rose-800 dark:text-rose-300">
          {error}
        </Text>
      ) : null}

      {pending ? (
        <View className="mt-3 rounded-lg border border-hairline dark:border-hairline-strong bg-slate-50 p-4 dark:bg-canvas">
          <Text className="text-sm text-secondary">
            {pending.requestedByRole === 'CUSTOMER' ? 'The customer' : 'The professional'} asked to
            move this booking to{' '}
            <Text className="font-semibold text-primary">
              {formatDate(pending.proposedStart)} at {formatTime(pending.proposedStart)}
            </Text>
            .
          </Text>
          {pending.reason ? (
            <Text className="mt-2 text-sm text-secondary">Their reason: {pending.reason}</Text>
          ) : null}
          <Text className="mt-2 text-sm text-muted">
            The current time stays until the other party accepts.
          </Text>

          {canDecide ? (
            <View className="mt-4 gap-3">
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: busy === 'accept',
                    busy: busy === 'accept',
                  }}
                  disabled={busy !== null}
                  onPress={() => void decide('ACCEPTED')}
                  className="min-h-11 justify-center rounded-lg bg-brand-800 px-4"
                >
                  {busy === 'accept' ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="font-semibold text-white">Accept new time</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: busy === 'reject' || !rejectValid,
                    busy: busy === 'reject',
                  }}
                  disabled={busy !== null || !rejectValid}
                  onPress={() => void decide('REJECTED')}
                  className="min-h-11 justify-center rounded-lg border border-rose-300 px-4 dark:border-rose-800"
                >
                  {busy === 'reject' ? (
                    <ActivityIndicator color="#047857" />
                  ) : (
                    <Text className="font-semibold text-rose-800 dark:text-rose-300">Decline</Text>
                  )}
                </Pressable>
              </View>
              <TextInput
                accessibilityLabel="Reason for declining"
                placeholder="Why doesn't the new time work? (required to decline)"
                value={decisionNote}
                onChangeText={setDecisionNote}
                multiline
                className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
              />
              {!rejectValid ? (
                <Text className="text-sm text-muted">A reason is required to decline.</Text>
              ) : null}
            </View>
          ) : null}

          {canWithdraw ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: busy === 'withdraw',
                busy: busy === 'withdraw',
              }}
              disabled={busy !== null}
              onPress={() => void withdraw()}
              className="mt-4 min-h-11 self-start justify-center rounded-lg border border-hairline-strong px-4"
            >
              {busy === 'withdraw' ? (
                <ActivityIndicator color="#047857" />
              ) : (
                <Text className="font-semibold text-secondary dark:text-primary">
                  Withdraw request
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : canRequest ? (
        <Text className="mt-2 text-sm text-secondary">
          No reschedule request is pending. The appointment is still for the current time.
        </Text>
      ) : null}

      {canRequest && !pending ? (
        proposeOpen ? (
          <View className="mt-3 rounded-lg border border-hairline dark:border-hairline-strong bg-slate-50 p-4 dark:bg-canvas">
            <Text className="text-sm font-semibold text-primary">Propose a new time</Text>
            <Text className="mt-1 text-sm text-secondary">
              The professional must accept before the appointment moves.
            </Text>
            <TextInput
              accessibilityLabel="New date and time"
              placeholder="New date and time (e.g. 2026-10-08 14:30)"
              value={proposedStart}
              onChangeText={setProposedStart}
              className="mt-3 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
            />
            <TextInput
              accessibilityLabel="Reason (optional)"
              placeholder="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              multiline
              className="mt-3 min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
            />
            <View className="mt-3 flex-row flex-wrap gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: busy === 'propose' || !proposeValid,
                  busy: busy === 'propose',
                }}
                disabled={busy !== null || !proposeValid}
                onPress={() => void propose()}
                className="min-h-11 justify-center rounded-lg bg-brand-800 px-4"
              >
                {busy === 'propose' ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="font-semibold text-white">Send request</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => setProposeOpen(false)}
                className="min-h-11 justify-center rounded-lg border border-hairline-strong px-4"
              >
                <Text className="font-semibold text-secondary dark:text-primary">Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setProposeOpen(true)}
            className="mt-4 min-h-11 self-start justify-center rounded-lg border border-hairline-strong px-4"
          >
            <Text className="font-semibold text-secondary dark:text-primary">
              Request a new time
            </Text>
          </Pressable>
        )
      ) : null}

      {actionError ? (
        <Text accessibilityRole="alert" className="mt-3 text-sm text-rose-800 dark:text-rose-300">
          {actionError}
        </Text>
      ) : null}
    </View>
  );
}

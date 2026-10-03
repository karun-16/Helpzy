import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { DISPUTE_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  formatDateTime,
} from '@/components/marketplace-ui';
import { StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Dispute = Awaited<ReturnType<typeof api.admin.disputes>>[number];
type Detail = Awaited<ReturnType<typeof api.admin.dispute>>;

const CATEGORY_LABELS: Record<string, string> = {
  SERVICE_NOT_AS_DESCRIBED: 'Work not as described',
  NO_SHOW: 'Nobody turned up',
  QUALITY_ISSUE: 'Poor quality',
  PROPERTY_DAMAGE: 'Property damage',
  PAYMENT_ISSUE: 'Payment problem',
  UNSAFE_BEHAVIOUR: 'Unsafe behaviour',
  OTHER: 'Other',
};

type Filter = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'ALL';

/**
 * Admin adjudication of booking disputes.
 *
 * Closing one lifts the suspension it caused and puts the booking back exactly
 * where it was, so the admin does not also have to repair the booking by hand.
 * The decision note is required and is sent to both parties.
 */
export function AdminDisputesPanel() {
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSeq = useRef(0);

  const load = useCallback((activeFilter: Filter) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    api.admin
      .disputes(activeFilter === 'ALL' ? {} : { status: activeFilter })
      .then((result) => {
        if (loadSeq.current === seq) setDisputes(result);
      })
      .catch(() => {
        if (loadSeq.current === seq) setError('Could not load disputes.');
      });
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  // Opening a dispute's history is a separate fetch so the list stays cheap.
  // A stale `detail` is ignored at render time by checking its id, so nothing has
  // to be cleared here.
  useEffect(() => {
    if (!openId) return;
    api.admin
      .dispute(openId)
      .then(setDetail)
      .catch(() => setError('Could not load that dispute.'));
  }, [openId]);

  const noteValid = note.trim().length >= 10;

  const act = async (dispute: Dispute, kind: 'review' | 'resolve' | 'reject') => {
    if (busy) return;
    setBusy(dispute.id);
    setError('');
    setNotice('');
    try {
      if (kind === 'review') {
        await api.admin.startDisputeReview(dispute.id);
        setNotice('Dispute marked as under review.');
      } else {
        await api.admin.resolveDispute(dispute.id, {
          status: kind === 'resolve' ? 'RESOLVED' : 'REJECTED',
          resolutionNote: note.trim(),
        });
        setNotice(
          kind === 'resolve'
            ? `Dispute resolved. Booking ${dispute.bookingReference} has resumed.`
            : `Dispute rejected. Booking ${dispute.bookingReference} has resumed.`,
        );
        setNote('');
      }
      load(filter);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not update the dispute.',
      );
    } finally {
      setBusy(null);
    }
  };

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'OPEN', label: 'Open' },
    { key: 'UNDER_REVIEW', label: 'Being reviewed' },
    { key: 'RESOLVED', label: 'Resolved' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <View className="mt-8">
      <Text className="text-xl font-bold text-primary">Disputes</Text>
      <Text className="mt-1 text-sm text-secondary">
        Each dispute pauses its booking. Closing one resumes the booking from where it paused.
      </Text>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {filters.map((entry) => {
          const selected = entry.key === filter;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${entry.label} disputes`}
              accessibilityState={{ selected }}
              onPress={() => setFilter(entry.key)}
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
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {disputes === null ? (
        <LoadingBlock label="Loading disputes..." />
      ) : disputes.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">No disputes in this view.</Text>
      ) : (
        <View className="mt-4 gap-3">
          {disputes.map((dispute) => {
            const closed =
              dispute.status === DISPUTE_STATUSES.RESOLVED ||
              dispute.status === DISPUTE_STATUSES.REJECTED;
            const isOpen = openId === dispute.id;

            return (
              <View
                key={dispute.id}
                className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="font-bold text-primary">
                      {CATEGORY_LABELS[dispute.category] ?? dispute.category}
                    </Text>
                    <Text className="mt-1 text-sm text-secondary">
                      Booking {dispute.bookingReference} · {dispute.openedBy.fullName} against{' '}
                      {dispute.against.fullName}
                    </Text>
                    <Text className="mt-1 text-xs text-tertiary">
                      {formatDateTime(dispute.createdAt)}
                    </Text>
                  </View>
                  <View className="gap-2">
                    <StatusBadge
                      label={
                        closed
                          ? dispute.status
                          : dispute.status === 'UNDER_REVIEW'
                            ? 'Reviewing'
                            : 'Open'
                      }
                      tone={closed ? 'neutral' : 'pending'}
                    />
                    <StatusBadge
                      label={`Booking: ${dispute.bookingStatus}`}
                      tone={dispute.bookingStatus === 'DISPUTED' ? 'error' : 'neutral'}
                    />
                  </View>
                </View>

                <Text className="mt-3 text-sm leading-5 text-primary">{dispute.reason}</Text>

                {isOpen ? (
                  <View className="mt-3 gap-3">
                    {detail?.id === dispute.id ? (
                      <View className="gap-2 rounded-lg border border-hairline bg-surface-muted p-3">
                        <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                          History
                        </Text>
                        {detail.events.map((event) => (
                          <View key={event.id} className="mt-2">
                            <Text className="text-xs font-semibold text-secondary">
                              {event.type} · {event.actor.fullName} ·{' '}
                              {formatDateTime(event.createdAt)}
                            </Text>
                            {event.body ? (
                              <Text className="mt-1 text-sm text-primary">{event.body}</Text>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    ) : (
                      <LoadingBlock label="Loading history..." />
                    )}

                    {!closed ? (
                      <>
                        <TextInput
                          accessibilityLabel="Decision note"
                          value={note}
                          onChangeText={setNote}
                          placeholder="Explain the outcome. Both parties will read this."
                          placeholderTextColor="#94a3b8"
                          multiline
                          className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                        />
                        <View className="flex-row flex-wrap gap-3">
                          <ActionButton
                            label="Resolve"
                            onPress={() => act(dispute, 'resolve')}
                            busy={busy === dispute.id}
                            disabled={busy !== null || !noteValid}
                          />
                          <ActionButton
                            label="Reject"
                            tone="subtle"
                            onPress={() => act(dispute, 'reject')}
                            busy={busy === dispute.id}
                            disabled={busy !== null || !noteValid}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                            onPress={() => setOpenId(null)}
                            disabled={busy !== null}
                            className="min-h-11 justify-center px-2"
                          >
                            <Text className="text-sm font-semibold text-secondary">Cancel</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : (
                  <View className="mt-3 flex-row flex-wrap gap-4">
                    {dispute.status === DISPUTE_STATUSES.OPEN ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Start reviewing this dispute"
                        disabled={busy !== null}
                        onPress={() => act(dispute, 'review')}
                      >
                        <Text className="text-sm font-semibold text-action-text">
                          Start reviewing
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={closed ? 'View this dispute' : 'Decide this dispute'}
                      disabled={busy !== null}
                      onPress={() => {
                        setOpenId(dispute.id);
                        setNote('');
                        setError('');
                        setNotice('');
                      }}
                    >
                      <Text className="text-sm font-semibold text-action-text">
                        {closed ? 'View history' : 'Open and decide'}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {closed && dispute.resolutionNote ? (
                  <View className="mt-3 rounded-lg border border-hairline bg-surface-muted p-3">
                    <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                      Decision
                    </Text>
                    <Text className="mt-1 text-sm text-primary">{dispute.resolutionNote}</Text>
                  </View>
                ) : null}
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

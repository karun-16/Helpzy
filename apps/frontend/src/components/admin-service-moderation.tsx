import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SERVICE_MODERATION_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
} from '@/components/marketplace-ui';
import { StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Service = Awaited<ReturnType<typeof api.admin.services>>[number];

type Filter = 'ALL' | 'PENDING' | 'WITHDRAWN' | 'ACTIVE';

/**
 * The badge a listing carries in the moderation queue.
 *
 * The moderation state decides it, not `isActive` alone, so an
 * admin can see at a glance which listings are waiting for a
 * decision, which are live, and which were rejected - states
 * that all differ but would otherwise all read "not live".
 */
function moderationBadge(service: Service): {
  label: string;
  tone: 'success' | 'error' | 'neutral' | 'pending';
} {
  switch (service.moderationStatus) {
    case SERVICE_MODERATION_STATUSES.PENDING:
      return { label: 'Pending review', tone: 'pending' };
    case SERVICE_MODERATION_STATUSES.REJECTED:
      return { label: 'Rejected', tone: 'error' };
    default:
      return service.isActive
        ? { label: 'Live', tone: 'success' }
        : { label: 'Withdrawn', tone: 'error' };
  }
}

/**
 * Admin moderation of individual service listings.
 *
 * Every action carries a reason, and the reason is stored on the service and
 * shown to its owner: a listing that silently disappeared from search would look
 * like a bug to the professional and generate a support conversation instead of
 * a fixable complaint.
 */
export function AdminServiceModeration() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  /** Which listing has its reason box open, and the visibility the
   * pending decision would leave it in, if any. */
  const [reasonFor, setReasonFor] = useState<{
    id: string;
    target: boolean;
  } | null>(null);
  const [reason, setReason] = useState('');

  /**
   * Search is debounced, so a slow first response must not overwrite a newer
   * one. The sequence ref lets only the most recent load write state.
   */
  const loadSeq = useRef(0);

  const load = useCallback((searchTerm: string, activeFilter: Filter) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    api.admin
      .services({
        ...(searchTerm ? { search: searchTerm } : {}),
        ...(activeFilter === 'WITHDRAWN' ? { onlyInactive: true } : {}),
      })
      .then((result) => {
        if (loadSeq.current === seq) setServices(result);
      })
      .catch(() => {
        if (loadSeq.current === seq) setError('Could not load listings.');
      });
  }, []);

  const trimmedSearch = search.trim();

  useEffect(() => {
    const timer = setTimeout(() => load(trimmedSearch, filter), 200);
    return () => clearTimeout(timer);
  }, [filter, load, trimmedSearch]);

  const visible = (services ?? []).filter((service) =>
    filter === 'ALL'
      ? true
      : filter === 'PENDING'
        ? service.moderationStatus === SERVICE_MODERATION_STATUSES.PENDING
        : filter === 'ACTIVE'
          ? service.isActive
          : !service.isActive,
  );

  const beginReason = (service: Service, target: boolean) => {
    setError('');
    setNotice('');
    // Every decision carries a reason, so the audit trail explains
    // both directions of a moderation call.
    setReason(service.moderationNote ?? '');
    setReasonFor({ id: service.id, target });
  };

  const cancelReason = () => {
    setReasonFor(null);
    setReason('');
  };

  const submit = async (service: Service, target: boolean) => {
    if (busy) return;
    setBusy(service.id);
    setError('');
    setNotice('');
    try {
      await api.admin.setServiceStatus(service.id, { isActive: target, reason: reason.trim() });
      setNotice(
        target
          ? `"${service.title}" is back on the marketplace.`
          : `"${service.title}" was withdrawn. The professional can see why, and its ${service.bookingCount} existing booking${
              service.bookingCount === 1 ? '' : 's'
            } are unaffected.`,
      );
      cancelReason();
      load(trimmedSearch, filter);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not update listing.',
      );
    } finally {
      setBusy(null);
    }
  };

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'PENDING', label: 'Pending review' },
    { key: 'ACTIVE', label: 'Live' },
    { key: 'WITHDRAWN', label: 'Withdrawn' },
  ];

  return (
    <View className="mt-8">
      <Text className="text-xl font-bold text-primary">Listing moderation</Text>
      <Text className="mt-1 text-sm text-secondary">
        Withdraw a listing that breaks the marketplace rules and restore it later. Existing bookings
        are never affected, and the professional sees the reason you give.
      </Text>

      <TextInput
        accessibilityLabel="Search listings"
        value={search}
        onChangeText={setSearch}
        placeholder="Search by listing or professional"
        placeholderTextColor="#94a3b8"
        className="mt-3 min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
      />

      <View className="mt-3 flex-row flex-wrap gap-2">
        {filters.map((entry) => {
          const selected = entry.key === filter;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${entry.label} listings`}
              accessibilityState={{ selected }}
              onPress={() => setFilter(entry.key)}
              className={`min-h-9 justify-center rounded-lg border px-3 ${
                selected
                  ? 'border-action-text bg-surface-muted'
                  : 'border-hairline-strong bg-surface'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${selected ? 'text-action-text' : 'text-secondary'}`}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {services === null ? (
        <LoadingBlock label="Loading listings..." />
      ) : visible.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">No listings match this view.</Text>
      ) : (
        <View className="mt-4 gap-3">
          {visible.map((service) => {
            const isBusy = busy === service.id;
            const isReviewing = reasonFor?.id === service.id;
            const target = reasonFor?.target ?? false;
            const badge = moderationBadge(service);

            return (
              <View
                key={service.id}
                className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="font-bold text-primary">{service.title}</Text>
                    <Text className="mt-1 text-sm text-secondary">
                      {service.category.name} · {service.owner.fullName} · {service.owner.phone}
                    </Text>
                    <Text className="mt-1 text-xs text-tertiary">
                      {service.durationMinutes} min · {service.ratingCount} review
                      {service.ratingCount === 1 ? '' : 's'} · {service.bookingCount} booking
                      {service.bookingCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <StatusBadge label={badge.label} tone={badge.tone} />
                </View>

                <View className="mt-2 flex-row flex-wrap gap-2">
                  <StatusBadge
                    label={`Account: ${service.owner.status}`}
                    tone={service.owner.status === 'ACTIVE' ? 'neutral' : 'error'}
                  />
                  <StatusBadge
                    label={`Verification: ${service.owner.verification}`}
                    tone={
                      service.owner.verification === 'VERIFIED'
                        ? 'success'
                        : service.owner.verification === 'REJECTED'
                          ? 'error'
                          : 'pending'
                    }
                  />
                </View>

                {service.moderationNote ? (
                  <View className="mt-3 rounded-lg border border-hairline bg-surface-muted p-3">
                    <Text className="text-xs font-semibold uppercase tracking-wide text-secondary">
                      Current reason
                    </Text>
                    <Text className="mt-1 text-sm text-primary">{service.moderationNote}</Text>
                  </View>
                ) : null}

                {isReviewing ? (
                  <View className="mt-3 gap-3">
                    <TextInput
                      accessibilityLabel="Reason for the change"
                      value={reason}
                      onChangeText={setReason}
                      placeholder={
                        target
                          ? 'Why are you approving this listing?'
                          : 'Why is this listing being withdrawn?'
                      }
                      placeholderTextColor="#94a3b8"
                      multiline
                      className="min-h-16 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                    />
                    <Text className="text-xs text-tertiary">
                      Recorded in the audit log and shown to {service.owner.fullName}.
                    </Text>
                    <View className="flex-row gap-3">
                      <ActionButton
                        label={target ? 'Confirm approval' : 'Confirm withdrawal'}
                        onPress={() => submit(service, target)}
                        busy={isBusy}
                        disabled={busy !== null || reason.trim().length < 3}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        onPress={cancelReason}
                        disabled={busy !== null}
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-sm font-semibold text-secondary">Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : service.moderationStatus === SERVICE_MODERATION_STATUSES.PENDING ? (
                  <View className="mt-3 flex-row flex-wrap gap-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Approve ${service.title}`}
                      disabled={busy !== null}
                      onPress={() => beginReason(service, true)}
                      className="self-start"
                    >
                      <Text className="text-sm font-semibold text-action-text">
                        {isBusy ? 'Working...' : 'Approve listing'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Reject ${service.title}`}
                      disabled={busy !== null}
                      onPress={() => beginReason(service, false)}
                      className="self-start"
                    >
                      <Text className="text-sm font-semibold text-danger">
                        {isBusy ? 'Working...' : 'Reject listing'}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      service.isActive ? `Withdraw ${service.title}` : `Restore ${service.title}`
                    }
                    disabled={busy !== null}
                    onPress={() => beginReason(service, !service.isActive)}
                    className="mt-3 self-start"
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        service.isActive ? 'text-danger' : 'text-action-text'
                      }`}
                    >
                      {isBusy
                        ? 'Working...'
                        : service.isActive
                          ? 'Withdraw listing'
                          : 'Restore listing'}
                    </Text>
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

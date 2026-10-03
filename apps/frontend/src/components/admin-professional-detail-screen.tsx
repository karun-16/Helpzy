import { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { AdminProfessionalDetailDto } from '@helpzy/api-client';

import {
  ActionButton,
  DetailRow,
  EmptyBlock,
  ErrorBlock,
  formatDateTime,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
  UserAvatar,
} from '@/components/marketplace-ui';
import { StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
type VerificationDecision = 'APPROVED' | 'REJECTED';

export function AdminProfessionalDetailScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [result, setResult] = useState<{
    userId: string;
    data: AdminProfessionalDetailDto | null;
    error: { code: string; message: string } | null;
  } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<AccountStatus | null>(null);
  const [pendingDecision, setPendingDecision] = useState<VerificationDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const data = result?.userId === userId ? result.data : null;
  const failed = result?.userId === userId && result.error;
  const load = useCallback(() => {
    if (!userId) return () => {};
    const controller = new AbortController();
    api.admin
      .professionalDetail(userId, controller.signal)
      .then((detail) => setResult({ userId, data: detail, error: null }))
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setResult({
            userId,
            data: null,
            error: {
              code: requestError instanceof ApiError ? requestError.code : '',
              message:
                requestError instanceof ApiError
                  ? requestError.message
                  : 'We couldn’t load this professional.',
            },
          });
        }
      });
    return () => controller.abort();
  }, [userId]);

  useFocusEffect(load);

  const changeStatus = async () => {
    if (!data || !pendingStatus || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.admin.setUserStatus(data.id, pendingStatus);
      const refreshed = await api.admin.professionalDetail(data.id);
      setResult({ userId: data.id, data: refreshed, error: null });
      setPendingStatus(null);
      setNotice(`Account status updated to ${pendingStatus.toLowerCase()}.`);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t update this account. Please refresh and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const decideVerification = async () => {
    if (!data || !pendingDecision || busy) return;
    if (pendingDecision === 'REJECTED' && !decisionNote.trim()) {
      setError('Add a reason before rejecting this verification.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.admin.decideVerification(data.profileId, pendingDecision, decisionNote.trim());
      const refreshed = await api.admin.professionalDetail(data.id);
      setResult({ userId: data.id, data: refreshed, error: null });
      setPendingDecision(null);
      setDecisionNote('');
      setNotice(
        pendingDecision === 'APPROVED'
          ? 'Verification approved and the professional notified.'
          : 'Verification rejected and the professional notified.',
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t record this verification decision.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleScreen role="ADMIN" homeRoute="/admin" onHome={() => router.replace('/admin')}>
      <ScreenShell>
        <SectionHeading title="Professional detail" onBack={() => router.replace('/admin')} />
        {data === null && !failed ? (
          <LoadingBlock label="Loading professional details..." />
        ) : result?.error?.code === 'NOT_FOUND' ? (
          <EmptyBlock
            title="Professional not found"
            detail="This account may have been removed or changed to a different role."
            actionLabel="Back to admin"
            onAction={() => router.replace('/admin')}
          />
        ) : failed || !data ? (
          <ErrorBlock onRetry={load} />
        ) : (
          <>
            <Panel title="Account and profile">
              <View className="flex-row flex-wrap items-center gap-4">
                <UserAvatar avatarUrl={data.avatarUrl} name={data.fullName} size={64} />
                <View className="min-w-48 flex-1">
                  <Text className="text-xl font-bold text-primary">{data.fullName}</Text>
                  <Text className="mt-1 text-sm text-secondary">{data.businessName}</Text>
                </View>
                <StatusPill
                  label={data.accountStatus}
                  tone={data.accountStatus === 'ACTIVE' ? 'success' : 'error'}
                />
              </View>
              <View className="mt-4 gap-2">
                <DetailRow label="Phone" value={data.phone || 'Not provided'} />
                <DetailRow label="Account email" value={data.email ?? 'Not provided'} />
                <DetailRow
                  label="Professional contact email"
                  value={data.contactEmail ?? 'Not provided'}
                />
                <DetailRow
                  label="Phone visible to customers"
                  value={data.isPhoneVisible ? 'Yes' : 'No'}
                />
                <DetailRow label="Account created" value={formatDateTime(data.accountCreatedAt)} />
                <DetailRow
                  label="Professional profile created"
                  value={formatDateTime(data.profileCreatedAt)}
                />
                <DetailRow label="Service area" value={data.serviceArea ?? 'Not provided'} />
                <DetailRow
                  label="Experience"
                  value={
                    data.yearsOfExperience === null
                      ? 'Not stated'
                      : `${data.yearsOfExperience} years`
                  }
                />
              </View>
              <Text className="mt-4 text-xs font-semibold uppercase text-muted">
                Professional description
              </Text>
              <Text className="mt-1 text-sm leading-6 text-secondary">
                {data.bio?.trim() || 'No professional description has been provided.'}
              </Text>
              <Text className="mt-4 text-xs text-muted">
                Verification documents are not collected or stored by the current application.
              </Text>
            </Panel>

            <Panel title="Verification">
              <View className="flex-row flex-wrap items-center gap-3">
                <StatusPill
                  label={data.verification.replaceAll('_', ' ')}
                  tone={data.verification === 'VERIFIED' ? 'success' : 'pending'}
                />
                {data.verifiedAt ? (
                  <Text className="text-sm text-secondary">
                    Verified {formatDateTime(data.verifiedAt)}
                  </Text>
                ) : null}
              </View>
              {data.rejectionNote ? (
                <DetailRow label="Previous decision reason" value={data.rejectionNote} />
              ) : null}
              {data.verification === 'UNVERIFIED' || data.verification === 'PENDING' ? (
                pendingDecision ? (
                  <View className="mt-4 rounded-lg border border-hairline bg-surface-muted p-4">
                    <Text className="font-semibold text-primary">
                      {pendingDecision === 'APPROVED'
                        ? 'Approve verification?'
                        : 'Reject verification?'}
                    </Text>
                    {pendingDecision === 'REJECTED' ? (
                      <TextInput
                        accessibilityLabel="Verification rejection reason"
                        value={decisionNote}
                        onChangeText={setDecisionNote}
                        placeholder="Explain what needs correction"
                        placeholderTextColor="#94a3b8"
                        multiline
                        className="mt-3 min-h-20 rounded-control border border-hairline-strong bg-surface px-3 py-2 text-primary"
                      />
                    ) : null}
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      <ActionButton
                        label="Confirm decision"
                        onPress={decideVerification}
                        busy={busy}
                        disabled={pendingDecision === 'REJECTED' && !decisionNote.trim()}
                      />
                      <ActionButton
                        label="Keep pending"
                        tone="subtle"
                        onPress={() => {
                          setPendingDecision(null);
                          setDecisionNote('');
                        }}
                        disabled={busy}
                      />
                    </View>
                  </View>
                ) : (
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <ActionButton
                      label="Approve"
                      onPress={() => setPendingDecision('APPROVED')}
                      disabled={busy}
                    />
                    <ActionButton
                      label="Reject with reason"
                      tone="danger"
                      onPress={() => setPendingDecision('REJECTED')}
                      disabled={busy}
                    />
                  </View>
                )
              ) : null}
            </Panel>

            <Panel title="Account access">
              {pendingStatus ? (
                <View className="rounded-lg border border-warning bg-warning-soft p-4">
                  <Text className="font-semibold text-primary">
                    Set this account to {pendingStatus.toLowerCase()}?
                  </Text>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <ActionButton
                      label="Confirm status change"
                      onPress={changeStatus}
                      busy={busy}
                    />
                    <ActionButton
                      label="Cancel"
                      tone="subtle"
                      onPress={() => setPendingStatus(null)}
                      disabled={busy}
                    />
                  </View>
                </View>
              ) : data.accountStatus === 'ACTIVE' ? (
                <View className="flex-row flex-wrap gap-2">
                  <ActionButton
                    label="Suspend account"
                    tone="danger"
                    onPress={() => setPendingStatus('SUSPENDED')}
                  />
                  <ActionButton
                    label="Deactivate account"
                    tone="danger"
                    onPress={() => setPendingStatus('DEACTIVATED')}
                  />
                </View>
              ) : (
                <ActionButton label="Restore account" onPress={() => setPendingStatus('ACTIVE')} />
              )}
            </Panel>

            <Panel title="Services">
              {data.services.length === 0 ? (
                <EmptyBlock
                  title="No services"
                  detail="This professional has not added any services."
                />
              ) : (
                <View className="gap-3">
                  {data.services.map((service) => (
                    <View key={service.id} className="rounded-lg border border-hairline p-4">
                      <View className="flex-row flex-wrap items-center justify-between gap-2">
                        <Text className="font-semibold text-primary">{service.title}</Text>
                        <StatusPill
                          label={service.active ? 'Active' : 'Inactive'}
                          tone={service.active ? 'success' : 'neutral'}
                        />
                      </View>
                      <Text className="mt-1 text-xs font-semibold uppercase text-action-text">
                        {service.category.name}
                      </Text>
                      <Text className="mt-2 text-sm leading-5 text-secondary">
                        {service.description || service.summary || 'No description provided.'}
                      </Text>
                      <Text className="mt-2 text-sm font-semibold text-primary">
                        {service.currency} {service.price.toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            <Panel title="Performance">
              <View className="flex-row flex-wrap gap-5">
                <Text className="text-sm text-secondary">Completed: {data.completedCount}</Text>
                <Text className="text-sm text-secondary">
                  Rating:{' '}
                  {data.ratingCount
                    ? `${data.averageRating.toFixed(1)} / 5 (${data.ratingCount})`
                    : 'No published ratings'}
                </Text>
              </View>
            </Panel>

            <Panel title="Recent bookings">
              {data.bookings.length === 0 ? (
                <EmptyBlock
                  title="No bookings"
                  detail="Bookings for this professional will appear here."
                />
              ) : (
                <View className="gap-2">
                  {data.bookings.map((booking) => (
                    <View
                      key={booking.id}
                      className="flex-row flex-wrap items-center justify-between gap-2 border-b border-hairline py-3"
                    >
                      <View className="min-w-44 flex-1">
                        <Text className="font-semibold text-primary">{booking.serviceTitle}</Text>
                        <Text className="mt-1 text-xs text-muted">
                          {booking.reference} · {booking.customerName} ·{' '}
                          {formatDateTime(booking.scheduledStart)}
                        </Text>
                      </View>
                      <StatusPill label={booking.status.replaceAll('_', ' ')} tone="neutral" />
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            <Panel title="Reviews">
              {data.reviews.length === 0 ? (
                <EmptyBlock
                  title="No reviews"
                  detail="Reviews for this professional will appear here."
                />
              ) : (
                <View className="gap-3">
                  {data.reviews.map((review) => (
                    <View key={review.id} className="rounded-lg border border-hairline p-4">
                      <View className="flex-row flex-wrap justify-between gap-2">
                        <Text className="font-semibold text-primary">
                          {review.rating}/5 · {review.serviceTitle}
                        </Text>
                        <StatusPill
                          label={review.status}
                          tone={review.status === 'PUBLISHED' ? 'success' : 'neutral'}
                        />
                      </View>
                      <Text className="mt-1 text-xs text-muted">
                        {review.customerName} · {review.bookingReference} ·{' '}
                        {formatDateTime(review.createdAt)}
                      </Text>
                      {review.comment ? (
                        <Text className="mt-2 text-sm leading-5 text-secondary">
                          {review.comment}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </Panel>
            <InlineError message={error} />
            <InlineSuccess message={notice} />
          </>
        )}
      </ScreenShell>
    </RoleScreen>
  );
}

import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  ActionButton,
  EmptyBlock,
  ErrorBlock,
  formatDateTime,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  RoleScreen,
  SectionHeading,
  UserAvatar,
} from '@/components/marketplace-ui';
import { StatusBadge, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthSession } from '@/lib/hooks';
import type {
  AdminUserSummaryDto,
  AdminVerificationRequestDto,
  ReviewDto,
} from '@helpzy/api-client';

/**
 * The administrator's console.
 *
 * Every number here is a count the server computed from real rows. Every action
 * is a real server-side decision with its own audit record; the client cannot
 * approve, verify or suspend anything on its own.
 */
export function AdminDashboardScreen() {
  const router = useRouter();
  // Live session, so the "signed in as" line updates if the session is refreshed.
  const admin = useAuthSession();

  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.admin.summary>> | null>(
    null,
  );
  const [requests, setRequests] = useState<AdminVerificationRequestDto[] | null>(null);
  const [users, setUsers] = useState<AdminUserSummaryDto[] | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof api.admin.auditLog>> | null>(null);
  const [reviews, setReviews] = useState<ReviewDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  /*
   * A single mounted-scope controller, so a manual reload and the focus reload
   * share one abort path. `fetchDashboard` is stable, so the focus effect no
   * longer needs a reload counter in its dependency list.
   */
  const controllerRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    Promise.all([
      api.admin.summary(controller.signal),
      api.admin.verificationRequests(controller.signal),
      api.admin.listUsers({}, controller.signal),
      api.admin.auditLog(controller.signal),
      api.reviews.listForModeration(controller.signal),
    ])
      .then(([summaryData, requestData, userData, auditData, reviewData]) => {
        setSummary(summaryData);
        setRequests(requestData);
        setUsers(userData);
        setAudit(auditData);
        setReviews(reviewData.reviews);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
  }, []);

  const load = useCallback(() => fetchDashboard(), [fetchDashboard]);

  useFocusEffect(
    useCallback(() => {
      fetchDashboard();
      return () => controllerRef.current?.abort();
    }, [fetchDashboard]),
  );

  const decide = async (profileId: string, decision: 'APPROVED' | 'REJECTED', note?: string) => {
    setBusyKey(profileId);
    setError('');
    setNotice('');
    try {
      await api.admin.decideVerification(profileId, decision, note);
      setNotice(
        decision === 'APPROVED'
          ? 'Professional verified and notified.'
          : 'Professional rejected and notified with your reason.',
      );
      setRejectingId(null);
      setRejectNote('');
      load();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t record that decision.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const moderate = async (review: ReviewDto) => {
    const next = review.status === 'PUBLISHED' ? 'reject' : 'publish';
    setBusyKey(review.id);
    setError('');
    try {
      await api.reviews.moderate(review.id, next);
      setNotice(`Review ${next === 'publish' ? 'published' : 'rejected'}.`);
      load();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t moderate that review.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const setUserStatus = async (
    user: AdminUserSummaryDto,
    status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
  ) => {
    setBusyKey(user.id);
    setError('');
    setNotice('');
    try {
      await api.admin.setUserStatus(user.id, status);
      setNotice(`${user.fullName} is now ${status.toLowerCase()}.`);
      load();
    } catch (requestError) {
      // The API refuses a self-change and refuses to remove the last active
      // admin. Both refusals are surfaced rather than hidden.
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t change that user’s status.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <RoleScreen role="ADMIN" homeRoute="/admin" onHome={() => router.replace('/admin')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }}>
        <View className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <SectionHeading
            title="Admin"
            action={
              <Pressable
                accessibilityRole="button"
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
            Signed in as {admin?.user.fullName ?? 'an administrator'}. Every action here is written
            to the audit log.
          </Text>

          {summary === null && !failed ? (
            <LoadingBlock label="Loading the dashboard..." />
          ) : failed ? (
            <ErrorBlock onRetry={load} />
          ) : summary ? (
            <>
              <View className="mt-6 flex-row flex-wrap gap-3">
                <MetricCard label="Users" value={summary.users.total} />
                <MetricCard label="Customers" value={summary.users.customers} />
                <MetricCard label="Professionals" value={summary.users.professionals} />
                <MetricCard label="Bookings" value={summary.bookings.total} />
                <MetricCard label="Payments paid" value={summary.payments.paid} />
                <MetricCard label="Pending verifications" value={summary.pendingVerifications} />
              </View>

              <InlineError message={error} />
              <InlineSuccess message={notice} />

              <Text className="mt-8 text-xl font-bold text-primary">Verification requests</Text>
              {requests === null ? (
                <LoadingBlock label="Loading verification requests..." />
              ) : requests.length === 0 ? (
                <EmptyBlock
                  title="No verification requests"
                  detail="Professionals waiting on a verification decision will appear here."
                />
              ) : (
                <View className="mt-3 gap-3">
                  {requests.map((request) => (
                    <View
                      key={request.profileId}
                      className="rounded-xl border border-hairline bg-surface p-5 dark:border-hairline-strong"
                    >
                      <View className="flex-row flex-wrap items-start justify-between gap-3">
                        {/*
                          The real photo, so the admin reviews the person
                          applying rather than a stock avatar.
                        */}
                        <UserAvatar
                          avatarUrl={request.avatarUrl}
                          name={request.businessName}
                          size={48}
                        />
                        <View className="min-w-48 flex-1">
                          <Text className="text-base font-bold text-primary">
                            {request.businessName}
                          </Text>
                          <Text className="mt-1 text-sm text-secondary">
                            {request.fullName} · {request.phone}
                          </Text>
                          {request.contactEmail ? (
                            <Text className="text-sm text-secondary">{request.contactEmail}</Text>
                          ) : null}
                        </View>
                        {/*
                          The real status, not a hardcoded "Pending": a brand new
                          registration is UNVERIFIED, which is a different state
                          from a submitted-but-unreviewed PENDING one.
                        */}
                        <StatusBadge
                          label={request.verification.replace('_', ' ')}
                          tone={
                            request.verification === 'PENDING' ||
                            request.verification === 'UNVERIFIED'
                              ? 'pending'
                              : 'neutral'
                          }
                        />
                      </View>
                      {request.bio ? (
                        <Text className="mt-3 text-sm leading-5 text-secondary dark:text-primary">
                          {request.bio}
                        </Text>
                      ) : null}

                      {/* The evidence the decision actually rests on. */}
                      <View className="mt-4 rounded-lg bg-slate-50 dark:bg-canvas p-4 dark:bg-slate-800/60">
                        <Text className="text-xs font-semibold uppercase text-muted">
                          Services offered
                        </Text>
                        {request.services.length === 0 ? (
                          <Text className="mt-1 text-sm text-secondary">
                            No services published yet.
                          </Text>
                        ) : (
                          <View className="mt-2 gap-1">
                            {request.services.map((service) => (
                              <View key={service.id} className="flex-row flex-wrap gap-x-2">
                                <Text className="text-sm font-semibold text-primary">
                                  {service.title}
                                </Text>
                                {/* A draft listing is shown as such rather than
                                    counted as live inventory. */}
                                {!service.isActive ? (
                                  <Text className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-400">
                                    Not published
                                  </Text>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>

                      <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-1">
                        <Text className="text-sm text-secondary dark:text-primary">
                          {request.serviceCount} service{request.serviceCount === 1 ? '' : 's'}{' '}
                          published
                        </Text>
                        <Text className="text-sm text-secondary dark:text-primary">
                          {request.bookingCount} booking{request.bookingCount === 1 ? '' : 's'}{' '}
                          taken
                        </Text>
                        <Text className="text-sm text-secondary dark:text-primary">
                          {request.yearsOfExperience === null
                            ? 'Experience not stated'
                            : `${request.yearsOfExperience} year${
                                request.yearsOfExperience === 1 ? '' : 's'
                              } experience`}
                        </Text>
                        <Text className="text-sm text-muted">
                          Applied {formatDateTime(request.submittedAt)}
                        </Text>
                      </View>
                      <ActionButton
                        label="Approve verification"
                        accessibilityLabel={`Approve ${request.businessName}`}
                        onPress={() => decide(request.profileId, 'APPROVED')}
                        busy={busyKey === request.profileId}
                      />
                      {rejectingId === request.profileId ? (
                        <View className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40">
                          <Text className="text-sm font-semibold text-primary">
                            A rejection must tell the professional why.
                          </Text>
                          <TextInputField
                            label="Reason"
                            value={rejectNote}
                            onChange={setRejectNote}
                            placeholder="Explain what is missing..."
                          />
                          <ActionButton
                            label="Confirm rejection"
                            tone="danger"
                            onPress={() => decide(request.profileId, 'REJECTED', rejectNote)}
                            busy={busyKey === request.profileId}
                            disabled={rejectNote.trim().length === 0}
                          />
                          <ActionButton
                            label="Cancel"
                            tone="subtle"
                            onPress={() => {
                              setRejectingId(null);
                              setRejectNote('');
                            }}
                          />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Reject ${request.businessName}`}
                          onPress={() => {
                            setRejectingId(request.profileId);
                            setRejectNote('');
                          }}
                          className="mt-4 min-h-11 justify-center self-start"
                        >
                          <Text className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                            Reject with a reason
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <Text className="mt-8 text-xl font-bold text-primary">Users</Text>
              {users === null ? (
                <LoadingBlock label="Loading users..." />
              ) : (
                <View className="mt-3 gap-3">
                  {users.map((user) => (
                    <View
                      key={user.id}
                      className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5"
                    >
                      <View className="flex-row flex-wrap items-start justify-between gap-3">
                        <View className="min-w-48 flex-1">
                          <Text className="text-base font-bold text-primary">{user.fullName}</Text>
                          <Text className="mt-1 text-sm text-secondary">
                            {user.phone} · {user.role}
                          </Text>
                        </View>
                        <StatusPill
                          label={user.status}
                          tone={user.status === 'ACTIVE' ? 'success' : 'error'}
                        />
                      </View>
                      <Text className="mt-2 text-xs text-muted">
                        Joined {formatDateTime(user.createdAt)}
                      </Text>
                      <View className="mt-3 flex-row flex-wrap gap-4">
                        {user.status === 'ACTIVE' ? (
                          <>
                            <UserAction
                              label="Suspend"
                              user={user}
                              status="SUSPENDED"
                              busy={busyKey === user.id}
                              onPress={setUserStatus}
                            />
                            <UserAction
                              label="Deactivate"
                              user={user}
                              status="DEACTIVATED"
                              busy={busyKey === user.id}
                              onPress={setUserStatus}
                            />
                          </>
                        ) : (
                          <UserAction
                            label="Reactivate"
                            user={user}
                            status="ACTIVE"
                            busy={busyKey === user.id}
                            onPress={setUserStatus}
                          />
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text className="mt-8 text-xl font-bold text-primary">Review moderation</Text>
              {reviews === null ? (
                <LoadingBlock label="Loading reviews..." />
              ) : reviews.length === 0 ? (
                <EmptyBlock
                  title="No reviews to moderate"
                  detail="Reviews appear here once a customer leaves one for a confirmed booking."
                />
              ) : (
                <View className="mt-3 gap-3">
                  {reviews.map((review) => (
                    <View
                      key={review.id}
                      className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5"
                    >
                      <View className="flex-row flex-wrap items-start justify-between gap-3">
                        <View className="min-w-48 flex-1">
                          <Text className="text-base font-bold text-primary">
                            {review.serviceTitle}
                          </Text>
                          <Text className="mt-1 text-sm text-secondary">
                            {review.customerName} · {review.bookingReference} · {review.rating}/5
                          </Text>
                        </View>
                        <StatusPill
                          label={review.status}
                          tone={review.status === 'PUBLISHED' ? 'success' : 'pending'}
                        />
                      </View>
                      {review.comment ? (
                        <Text className="mt-3 text-sm leading-6 text-secondary dark:text-primary">
                          {review.comment}
                        </Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${review.status === 'PUBLISHED' ? 'Reject' : 'Publish'} this review`}
                        accessibilityState={{ busy: busyKey === review.id }}
                        disabled={busyKey === review.id}
                        onPress={() => moderate(review)}
                        className="mt-3 min-h-11 justify-center self-start"
                      >
                        <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                          {review.status === 'PUBLISHED'
                            ? 'Reject this review'
                            : 'Publish this review'}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <Text className="mt-8 text-xl font-bold text-primary">Audit log</Text>
              {audit === null ? (
                <LoadingBlock label="Loading the audit log..." />
              ) : audit.length === 0 ? (
                <EmptyBlock
                  title="No audit records yet"
                  detail="Every privileged action is recorded here as it happens."
                />
              ) : (
                <View className="mt-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
                  {audit.map((entry, index) => (
                    <View
                      key={entry.id}
                      className={`px-5 py-4 ${index === 0 ? '' : 'border-t border-hairline dark:border-hairline-strong'}`}
                    >
                      <Text className="text-sm font-semibold text-primary">{entry.action}</Text>
                      <Text className="mt-1 text-xs text-secondary">
                        {entry.actorName} · {entry.entityType} · {formatDateTime(entry.createdAt)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </View>
      </ScrollView>
    </RoleScreen>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <View className="min-w-32 flex-1 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-4">
      <Text className="text-3xl font-black text-primary">{value}</Text>
      <Text className="mt-1 text-sm text-secondary">{label}</Text>
    </View>
  );
}

function UserAction({
  label,
  user,
  status,
  busy,
  onPress,
}: {
  label: string;
  user: AdminUserSummaryDto;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  busy: boolean;
  onPress: (user: AdminUserSummaryDto, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED') => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${user.fullName}`}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={() => onPress(user, status)}
      className="min-h-11 justify-center"
    >
      <Text
        className={`text-sm font-semibold ${
          status === 'ACTIVE'
            ? 'text-brand-800 dark:text-brand-300'
            : 'text-rose-700 dark:text-rose-300'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TextInputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <View className="mt-3">
      <Text className="text-xs font-semibold uppercase text-muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        multiline
        className="mt-1 min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 align-top text-base text-primary"
      />
    </View>
  );
}

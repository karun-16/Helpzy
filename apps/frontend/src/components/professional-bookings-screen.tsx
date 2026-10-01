import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BOOKING_LIFECYCLE,
  BOOKING_STATUSES,
  nextBookingLifecycleStatus,
  PROFESSIONAL_LIFECYCLE_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  type BookingStatus,
  type ProfessionalLifecycleStatus,
} from '@helpzy/types';

import { ProfessionalBookingTimeline } from '@/components/booking-timeline';
import { BookingChatPanel, ProfessionalPaymentPanel } from '@/components/booking-panels';
import { RoleScreen } from '@/components/marketplace-ui';
import { StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type ProfessionalBooking = Awaited<
  ReturnType<typeof api.professionalBookings.listIncoming>
>[number];

const LIFECYCLE_ACTION_LABELS: Record<ProfessionalLifecycleStatus, string> = {
  SCHEDULED: 'Mark scheduled',
  ON_THE_WAY: 'Mark on the way',
  IN_PROGRESS: 'Mark in progress',
  COMPLETED_BY_PROFESSIONAL: 'Mark completed',
};

/**
 * Statuses that count as work in hand rather than a decision waiting on the
 * professional. Derived from the shared lifecycle so it cannot drift from the
 * statuses the API actually produces.
 */
const ACTIVE_JOB_STATUSES: readonly BookingStatus[] = BOOKING_LIFECYCLE.filter(
  (status) => status !== BOOKING_STATUSES.CLOSED,
);

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function friendlyStatus(status: ProfessionalBooking['status']) {
  return status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function ProfessionalDashboardScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    data: ProfessionalBooking[];
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const current = result?.request === reload;
  const bookings = current ? result.data : null;
  const error = current && result.error;
  const loadedBookings = bookings ?? [];

  /**
   * Counters derived from the bookings this screen already loaded, so the
   * numbers describe the same list shown below instead of a second query that
   * could disagree with it. `REQUESTED` is the only status waiting on the
   * professional's decision; everything else in progress is upcoming work.
   */
  const newRequests = loadedBookings.filter((booking) => booking.status === 'REQUESTED').length;
  const upcomingJobs = loadedBookings.filter((booking) =>
    ACTIVE_JOB_STATUSES.includes(booking.status),
  ).length;

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.professionalBookings
        .listIncoming(controller.signal)
        .then((data) => setResult({ request: reload, data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ request: reload, data: [], error: true });
        });
      return () => controller.abort();
    }, [reload]),
  );

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <View className="flex-row flex-wrap items-end justify-between gap-4">
            <View>
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                Professional workspace
              </Text>
              <Text className="mt-1 text-3xl font-black text-primary">Dashboard</Text>
              <Text className="mt-2 text-base text-secondary">
                Incoming service requests assigned to you.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh incoming bookings"
              onPress={() => setReload((value) => value + 1)}
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                Refresh
              </Text>
            </Pressable>
          </View>

          {/*
            The header already carries Dashboard / My Jobs / Services / Reviews
            and the account menu, so these shortcuts are kept only as a visible
            on-page path to the same routes rather than a second navigation set.
          */}
          <View className="mt-5 flex-row flex-wrap gap-5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to My Jobs"
              onPress={() => router.push('/professional/my-jobs')}
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                My Jobs
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to My Services"
              onPress={() => router.push('/professional/services')}
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                My Services
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to My Profile"
              onPress={() => router.push('/professional/profile')}
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                My Profile
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to My Reviews"
              onPress={() => router.push('/professional/reviews')}
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                My Reviews
              </Text>
            </Pressable>
          </View>

          <View className="mt-7 flex-row flex-wrap gap-6">
            <View className="min-w-40 flex-1 flex-row items-center gap-4 border-y border-hairline dark:border-hairline-strong py-4">
              <Text className="text-3xl font-black text-primary">
                {bookings === null ? '—' : newRequests}
              </Text>
              <View>
                <Text className="text-sm font-semibold text-primary">New requests</Text>
                <Text className="text-sm text-secondary">Awaiting your decision</Text>
              </View>
            </View>
            <View className="min-w-40 flex-1 flex-row items-center gap-4 border-b border-hairline py-4 dark:border-hairline-strong">
              <Text className="text-3xl font-black text-primary">
                {bookings === null ? '—' : upcomingJobs}
              </Text>
              <View>
                <Text className="text-sm font-semibold text-primary">Upcoming jobs</Text>
                <Text className="text-sm text-secondary">Confirmed or in progress</Text>
              </View>
            </View>
          </View>

          <View className="mt-7 flex-row items-baseline justify-between gap-3">
            <Text className="text-xl font-bold text-primary">Incoming bookings</Text>
            {bookings ? (
              <Text className="text-sm text-muted">{bookings.length} requests</Text>
            ) : null}
          </View>
          {bookings === null && !error ? (
            <View className="mt-4 min-h-32 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading requests...</Text>
            </View>
          ) : error ? (
            <View className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-surface p-5">
              <Text className="font-semibold text-primary">We couldn't load your requests.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReload((value) => value + 1)}
                className="mt-3 self-start"
              >
                <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : loadedBookings.length === 0 ? (
            <View className="mt-4 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-8">
              <Text className="text-base font-semibold text-primary">No incoming requests</Text>
              <Text className="mt-1 text-sm text-secondary">
                New customer bookings will appear here.
              </Text>
            </View>
          ) : (
            <View className="mt-4 gap-3">
              {loadedBookings.map((booking) => (
                <Pressable
                  key={booking.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/professional/bookings/${booking.id}`)}
                  className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5 active:border-brand-700"
                >
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-48 flex-1">
                      <Text className="text-base font-bold text-primary">
                        {booking.service.title}
                      </Text>
                      <Text className="mt-1 text-sm text-secondary">
                        Requested by {booking.customer.fullName}
                      </Text>
                    </View>
                    <StatusLabel status={booking.status} />
                  </View>
                  <View className="mt-4 flex-row flex-wrap gap-x-6 gap-y-2">
                    <Text className="text-sm text-secondary dark:text-primary">
                      {formatDate(booking.scheduledStart)}
                    </Text>
                    <Text className="text-sm text-secondary dark:text-primary">
                      {formatTime(booking.scheduledStart)}
                    </Text>
                    <Text className="text-sm text-muted">{booking.reference}</Text>
                  </View>
                  {booking.requirement ? (
                    <Text className="mt-3 text-sm leading-5 text-secondary" numberOfLines={2}>
                      {booking.requirement}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </RoleScreen>
  );
}

export function ProfessionalBookingDetailsScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [result, setResult] = useState<{
    id: string;
    data: ProfessionalBooking | null;
    error: boolean;
  } | null>(null);
  const [decision, setDecision] = useState<'ACCEPTED' | 'REJECTED' | null>(null);
  const [rejectConfirm, setRejectConfirm] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState<ProfessionalLifecycleStatus | null>(null);
  const [advanceError, setAdvanceError] = useState('');
  const current = result?.id === bookingId;
  const booking = current ? result.data : null;
  const loading = Boolean(bookingId) && !current;
  const error = !bookingId || (current && result.error);

  useEffect(() => {
    if (!bookingId) return;
    const controller = new AbortController();
    api.professionalBookings
      .get(bookingId, controller.signal)
      .then((data) => setResult({ id: bookingId, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ id: bookingId, data: null, error: true });
      });
    return () => controller.abort();
  }, [bookingId]);

  /**
   * The only action the assigned professional may take from here. Derived from
   * the shared state machine, so the screen never offers a step the API would
   * reject.
   */
  const nextAction = booking
    ? (nextBookingLifecycleStatus(booking.status) as ProfessionalLifecycleStatus | null)
    : null;
  const canAdvance =
    nextAction !== null && PROFESSIONAL_LIFECYCLE_STATUSES.includes(nextAction as never);

  const advance = async (action: ProfessionalLifecycleStatus) => {
    if (!booking || advancing) return;
    setAdvancing(action);
    setAdvanceError('');
    try {
      const updated = await api.professionalBookings.advance(booking.id, action);
      setResult({ id: updated.id, data: updated, error: false });
    } catch (requestError) {
      setAdvanceError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldnâ€™t update this booking. Please try again.',
      );
    } finally {
      setAdvancing(null);
    }
  };

  const submitDecision = async (nextStatus: 'ACCEPTED' | 'REJECTED') => {
    if (!booking || submitting) return;
    setSubmitting(true);
    setDecisionError('');
    try {
      const updated =
        nextStatus === 'ACCEPTED'
          ? await api.professionalBookings.accept(booking.id)
          : await api.professionalBookings.reject(booking.id);
      setResult({ id: updated.id, data: updated, error: false });
      setDecision(nextStatus);
      setRejectConfirm(false);
    } catch (requestError) {
      setDecisionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldnâ€™t update this booking. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to dashboard"
            onPress={() => router.back()}
            className="mb-5 self-start"
          >
            <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
              â† Back to dashboard
            </Text>
          </Pressable>
          {loading ? (
            <View className="min-h-32 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading booking...</Text>
            </View>
          ) : error || !booking ? (
            <View className="rounded-xl border border-rose-200 dark:border-rose-900 bg-surface p-5">
              <Text className="font-semibold text-primary">We couldnâ€™t find that booking.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/professional')}
                className="mt-3 self-start"
              >
                <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                  Back to dashboard
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5 sm:p-7">
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View>
                  <Text className="text-xs font-semibold uppercase text-muted">
                    Booking reference
                  </Text>
                  <Text className="mt-1 text-xl font-bold text-primary">{booking.reference}</Text>
                </View>
                <StatusLabel status={booking.status} />
              </View>
              <View className="mt-6 gap-5 border-t border-hairline dark:border-hairline-strong pt-5">
                <DetailValue label="Service" value={booking.service.title} />
                <DetailValue label="Customer" value={booking.customer.fullName} />
                <DetailValue label="Scheduled date" value={formatDate(booking.scheduledStart)} />
                <DetailValue label="Scheduled time" value={formatTime(booking.scheduledStart)} />
                <DetailValue
                  label="Requirement"
                  value={booking.requirement || 'No additional requirement provided.'}
                />
                <DetailValue label="Service location" value={formatLocation(booking)} />
                <DetailValue label="Current status" value={friendlyStatus(booking.status)} />
              </View>

              {booking.status === 'REQUESTED' ? (
                <View className="mt-7 border-t border-hairline dark:border-hairline-strong pt-5">
                  {rejectConfirm ? (
                    <View className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4">
                      <Text className="font-semibold text-primary">
                        Reject this booking request?
                      </Text>
                      <Text className="mt-1 text-sm text-secondary">
                        This decision cannot be changed from this screen.
                      </Text>
                      <View className="mt-4 flex-row flex-wrap gap-3">
                        <Pressable
                          accessibilityRole="button"
                          disabled={submitting}
                          onPress={() => submitDecision('REJECTED')}
                          className="min-h-11 justify-center rounded-lg bg-rose-700 px-4"
                        >
                          <Text className="font-semibold text-white">
                            {submitting ? 'Rejecting...' : 'Confirm rejection'}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={submitting}
                          onPress={() => setRejectConfirm(false)}
                          className="min-h-11 justify-center rounded-lg border border-hairline-strong px-4"
                        >
                          <Text className="font-semibold text-secondary dark:text-primary">
                            Keep request
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View className="flex-row flex-wrap gap-3">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: submitting, busy: submitting }}
                        disabled={submitting}
                        onPress={() => submitDecision('ACCEPTED')}
                        className="min-h-12 flex-1 items-center justify-center rounded-lg bg-brand-800 px-5"
                      >
                        {submitting ? (
                          <ActivityIndicator color="#ffffff" />
                        ) : (
                          <Text className="font-semibold text-white">Accept request</Text>
                        )}
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: submitting }}
                        disabled={submitting}
                        onPress={() => setRejectConfirm(true)}
                        className="min-h-12 flex-1 items-center justify-center rounded-lg border border-rose-300 px-5"
                      >
                        <Text className="font-semibold text-rose-800 dark:text-rose-300">
                          Reject request
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : canAdvance && nextAction ? (
                <View className="mt-7 border-t border-hairline dark:border-hairline-strong pt-5">
                  <Text className="text-sm font-medium text-secondary dark:text-primary">
                    {booking.status === 'ACCEPTED'
                      ? 'This booking is accepted and waiting for you to schedule the visit.'
                      : 'Keep the customer updated as you move this booking along.'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: advancing !== null,
                      busy: advancing !== null,
                    }}
                    disabled={advancing !== null}
                    onPress={() => advance(nextAction)}
                    className="mt-4 min-h-12 items-center justify-center rounded-lg bg-brand-800 px-5"
                  >
                    {advancing === nextAction ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text className="font-semibold text-white">
                        {LIFECYCLE_ACTION_LABELS[nextAction]}
                      </Text>
                    )}
                  </Pressable>
                  {advanceError ? (
                    <Text
                      accessibilityRole="alert"
                      className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                    >
                      {advanceError}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View className="mt-7 rounded-lg bg-slate-50 dark:bg-canvas px-4 py-3">
                  <Text className="text-sm font-medium text-secondary dark:text-primary">
                    {booking.status === 'CUSTOMER_CONFIRMED'
                      ? 'The customer confirmed this booking is complete. No further action is needed.'
                      : `This request has been ${friendlyStatus(booking.status).toLocaleLowerCase()}.`}
                  </Text>
                </View>
              )}
              {decision ? (
                <Text className="mt-3 text-sm font-medium text-brand-800 dark:text-brand-300">
                  Request {decision === 'ACCEPTED' ? 'accepted' : 'rejected'}.
                </Text>
              ) : null}
              {decisionError ? (
                <Text
                  accessibilityRole="alert"
                  className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                >
                  {decisionError}
                </Text>
              ) : null}
              <ProfessionalBookingTimeline bookingId={booking.id} />
              <BookingChatPanel
                bookingId={booking.id}
                readOnly={TERMINAL_BOOKING_STATUSES.includes(booking.status)}
                readOnlyReason="This booking is closed, so the conversation is read-only."
              />
              {['PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(booking.status) ? (
                <ProfessionalPaymentPanel bookingId={booking.id} />
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </RoleScreen>
  );
}

function StatusLabel({ status }: { status: ProfessionalBooking['status'] }) {
  // Shared pill, so the label colour lands on the Text rather than the container.
  const tone =
    status === 'REQUESTED'
      ? 'pending'
      : status === 'REJECTED' || status === 'DISPUTED'
        ? 'error'
        : status === 'CUSTOMER_CONFIRMED'
          ? 'success'
          : 'neutral';
  return <StatusPill label={friendlyStatus(status)} tone={tone} />;
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase text-muted">{label}</Text>
      <Text className="mt-1 text-base leading-6 text-primary">{value}</Text>
    </View>
  );
}

function formatLocation(booking: ProfessionalBooking) {
  if (!booking.location) return 'No service location provided';
  return [
    booking.location.label,
    booking.location.line1,
    booking.location.line2,
    `${booking.location.city}, ${booking.location.state} ${booking.location.postalCode}`,
  ]
    .filter(Boolean)
    .join(', ');
}

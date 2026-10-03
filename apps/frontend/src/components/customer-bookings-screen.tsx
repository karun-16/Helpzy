import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TERMINAL_BOOKING_STATUSES } from '@helpzy/types';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import {
  BookingChatPanel,
  BookingPaymentPanel,
  LeaveReviewPanel,
  ProfessionalLocationPanel,
} from '@/components/booking-panels';
import { CustomerBookingTimeline } from '@/components/booking-timeline';
import { DisputePanel } from '@/components/dispute-panel';
import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { ReschedulePanel } from '@/components/reschedule-panel';
import { StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { clearAuthSession } from '@/lib/auth-session';
import { useAuthSession } from '@/lib/hooks';

type CustomerBooking = Awaited<ReturnType<typeof api.customerBookings.list>>[number];
/** Who has confirmed completion, and whether this customer still owes theirs. */
type CompletionState = Awaited<ReturnType<typeof api.customerBookings.completionState>>;

/**
 * Which statuses unlock each downstream panel, mirroring the server guards.
 * A panel is hidden rather than shown-disabled so the screen never offers an
 * action the API would reject.
 */
const PAYMENT_STATUSES: CustomerBooking['status'][] = [
  'CUSTOMER_CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
  'CLOSED',
];
const LOCATION_STATUSES: CustomerBooking['status'][] = ['SCHEDULED', 'ON_THE_WAY', 'IN_PROGRESS'];
const REVIEWABLE_STATUSES: CustomerBooking['status'][] = [
  'COMPLETED_BY_PROFESSIONAL',
  'CUSTOMER_CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
  'CLOSED',
];
const CANCELLABLE_STATUSES: CustomerBooking['status'][] = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'];
const CLOSABLE_STATUSES: CustomerBooking['status'][] = ['PAID'];
const REBOOKABLE_STATUSES: CustomerBooking['status'][] = [
  'REJECTED',
  'CANCELLED',
  'CUSTOMER_CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
  'CLOSED',
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function friendlyStatus(status: CustomerBooking['status']) {
  return status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const STATUS_EXPLANATIONS: Partial<Record<CustomerBooking['status'], string>> = {
  REQUESTED: 'Waiting for the professional to respond.',
  ACCEPTED: 'Accepted. The professional will schedule the visit next.',
  SCHEDULED: 'Scheduled and confirmed for your appointment.',
  ON_THE_WAY: 'The professional is on the way to you.',
  IN_PROGRESS: 'The work is underway.',
  COMPLETED_BY_PROFESSIONAL: 'Marked complete. Please confirm to finish this booking.',
  CUSTOMER_CONFIRMED: 'You confirmed this booking is complete.',
  PAYMENT_PENDING: 'Payment is being set up.',
  PAID: 'Payment settled. Close the booking once the work is wrapped up.',
  CLOSED: 'This booking is closed.',
  REJECTED: 'The professional declined this request.',
  CANCELLED: 'This booking was cancelled.',
};

/**
 * Both parties' confirmation, read from the server's completion record.
 *
 * Deliberately shows the *waiting* state as well as the confirmations: a booking
 * that is `COMPLETED_BY_PROFESSIONAL` looks identical to one where both sides
 * agreed until you look at the timestamps, and telling someone a job is complete
 * when only one side confirmed is exactly the confusion this panel removes.
 */
function CompletionLines({
  state,
  viewer,
}: {
  state: CompletionState;
  viewer: 'customer' | 'professional';
}) {
  const professionalLabel = state.professionalConfirmedByName ?? 'The professional';
  const customerLabel = state.customerConfirmedByName ?? 'You';
  const viewerLabel = viewer === 'customer' ? customerLabel : professionalLabel;
  const otherLabel = viewer === 'customer' ? professionalLabel : customerLabel;

  return (
    <View className="mt-3 gap-y-2">
      <Text className="text-sm text-secondary">
        {viewerLabel}:{' '}
        {viewer === 'customer'
          ? state.customerConfirmedAt
            ? `confirmed on ${formatDate(state.customerConfirmedAt)}`
            : 'not confirmed yet'
          : state.professionalConfirmedAt
            ? `marked complete on ${formatDate(state.professionalConfirmedAt)}`
            : 'not marked complete yet'}
      </Text>
      <Text className="text-sm text-secondary">
        {otherLabel}:{' '}
        {viewer === 'customer'
          ? state.professionalConfirmedAt
            ? `marked complete on ${formatDate(state.professionalConfirmedAt)}`
            : 'has not marked it complete yet'
          : state.customerConfirmedAt
            ? `confirmed on ${formatDate(state.customerConfirmedAt)}`
            : 'has not confirmed yet'}
      </Text>
      <Text className="text-sm font-semibold text-primary">
        {state.isComplete
          ? 'Both parties have confirmed this booking is complete.'
          : 'This booking is not complete until both parties confirm.'}
      </Text>
    </View>
  );
}

export function CustomerBookingsScreen() {
  const router = useRouter();
  const session = useAuthSession();
  const [bookingsResult, setBookingsResult] = useState<{
    request: number;
    data: CustomerBooking[];
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const bookingsCurrent = bookingsResult?.request === reload;
  const bookings = bookingsCurrent ? bookingsResult.data : null;
  const error = bookingsCurrent && bookingsResult.error;
  const loadedBookings = bookings ?? [];

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.customerBookings
        .list(controller.signal)
        .then((data) => setBookingsResult({ request: reload, data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setBookingsResult({ request: reload, data: [], error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <View className="flex-1 bg-slate-50 dark:bg-canvas">
        <CustomerMarketplaceHeader
          customerName={session?.user.fullName ?? 'Customer'}
          onHomePress={() => router.replace('/customer')}
          onLogout={logout}
        />
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          <View className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/customer')}
              className="mb-5 self-start"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                ← Back to home
              </Text>
            </Pressable>
            <View className="flex-row flex-wrap items-end justify-between gap-3">
              <View>
                <Text className="text-3xl font-black text-primary">My Bookings</Text>
                <Text className="mt-2 text-base text-secondary">
                  Your service requests and appointments.
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setReload((value) => value + 1)}>
                <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                  Refresh
                </Text>
              </Pressable>
            </View>
            {bookings === null && !error ? (
              <View className="mt-6 min-h-32 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
                <ActivityIndicator color="#047857" />
                <Text className="text-sm text-secondary">Loading bookings...</Text>
              </View>
            ) : error ? (
              <View className="mt-6 rounded-xl border border-rose-200 dark:border-rose-900 bg-surface p-5">
                <Text className="font-semibold text-primary">We couldn’t load your bookings.</Text>
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
              <View className="mt-6 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-8">
                <Text className="text-base font-semibold text-primary">
                  You don&apos;t have any bookings yet.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.replace('/customer')}
                  className="mt-4 self-start"
                >
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    Find a service
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="mt-6 gap-3">
                {loadedBookings.map((booking) => (
                  <Pressable
                    key={booking.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/customer/bookings/${booking.id}`)}
                    className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5 active:border-brand-700"
                  >
                    <View className="flex-row flex-wrap items-start justify-between gap-3">
                      <View className="min-w-48 flex-1">
                        <Text className="text-base font-bold text-primary">
                          {booking.service.title}
                        </Text>
                        <Text className="mt-1 text-sm text-secondary">
                          {booking.professional.businessName}
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
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </AuthenticatedRoleScreen>
  );
}

export function CustomerBookingDetailsScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const session = useAuthSession();
  const [bookingResult, setBookingResult] = useState<{
    id: string;
    data: CustomerBooking | null;
    error: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [closePrompt, setClosePrompt] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const bookingCurrent = bookingResult?.id === bookingId;
  const booking = bookingCurrent ? bookingResult.data : null;
  const bookingStatus = booking?.status ?? null;
  const loading = Boolean(bookingId) && !bookingCurrent;
  const error = !bookingId || (bookingCurrent && bookingResult.error);

  useEffect(() => {
    if (!bookingId) return;
    const controller = new AbortController();
    api.customerBookings
      .get(bookingId, controller.signal)
      .then((data) => setBookingResult({ id: bookingId, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setBookingResult({ id: bookingId, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [bookingId]);

  /**
   * The completion record is the only thing that says whether *both* parties
   * agreed. It is read separately from the booking because a booking that reached
   * `COMPLETED_BY_PROFESSIONAL` still owes the customer their confirmation, and
   * only the two timestamps distinguish "waiting on the customer" from "waiting
   * on the professional".
   */
  useEffect(() => {
    if (!bookingId) return;
    const controller = new AbortController();
    api.customerBookings
      .completionState(bookingId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCompletion(data);
      })
      .catch(() => {
        // The booking still renders; only the completion panel is unavailable.
        if (!controller.signal.aborted) setCompletion(null);
      });
    return () => controller.abort();
    // Re-read whenever the booking status moves, so the panel cannot go stale
    // after one side confirms.
  }, [bookingId, bookingStatus]);

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  const reloadBooking = async () => {
    if (!bookingId) return;
    const [updated, state] = await Promise.all([
      api.customerBookings.get(bookingId),
      api.customerBookings.completionState(bookingId).catch(() => null),
    ]);
    setBookingResult({ id: bookingId, data: updated, error: false });
    setCompletion(state);
  };

  const confirmCompletion = async () => {
    if (!booking || confirming) return;
    setConfirming(true);
    setConfirmError('');
    try {
      await api.customerBookings.markCompleted(booking.id);
      // The endpoint answers with the completion state; the booking is re-read so
      // the status pill and the payment panel reflect the same moment.
      await reloadBooking();
    } catch (requestError) {
      setConfirmError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t confirm this booking. Please try again.',
      );
    } finally {
      setConfirming(false);
    }
  };

  const cancelBooking = async () => {
    if (!booking || cancelling) return;
    setCancelling(true);
    setCancelError('');
    try {
      const updated = await api.customerBookings.cancel(booking.id);
      setBookingResult({ id: updated.id, data: updated, error: false });
      setCancelPrompt(false);
    } catch (requestError) {
      setCancelError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t cancel this booking. Refresh and try again.',
      );
    } finally {
      setCancelling(false);
    }
  };

  const closeBooking = async () => {
    if (!booking || closing) return;
    setClosing(true);
    setCloseError('');
    try {
      const updated = await api.customerBookings.close(booking.id);
      setBookingResult({ id: updated.id, data: updated, error: false });
      setClosePrompt(false);
    } catch (requestError) {
      setCloseError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t close this booking. Refresh and try again.',
      );
    } finally {
      setClosing(false);
    }
  };

  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <View className="flex-1 bg-slate-50 dark:bg-canvas">
        <CustomerMarketplaceHeader
          customerName={session?.user.fullName ?? 'Customer'}
          onHomePress={() => router.replace('/customer')}
          onLogout={logout}
        />
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          <View className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="mb-5 self-start"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                ← Back to My Bookings
              </Text>
            </Pressable>
            {loading ? (
              <View className="min-h-32 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
                <ActivityIndicator color="#047857" />
                <Text className="text-sm text-secondary">Loading booking...</Text>
              </View>
            ) : error || !booking ? (
              <View className="rounded-xl border border-rose-200 dark:border-rose-900 bg-surface p-5">
                <Text className="font-semibold text-primary">We couldn’t find that booking.</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.replace('/customer/bookings')}
                  className="mt-3 self-start"
                >
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    View My Bookings
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
                  <DetailValue
                    label="Professional"
                    value={`${booking.professional.businessName} · ${booking.professional.fullName}`}
                  />
                  <DetailValue label="Date" value={formatDate(booking.scheduledStart)} />
                  <DetailValue label="Time" value={formatTime(booking.scheduledStart)} />
                  <DetailValue
                    label="Requirement"
                    value={booking.requirement || 'No additional requirement provided.'}
                  />
                  <DetailValue label="Service location" value={formatLocation(booking)} />
                  <DetailValue label="Current status" value={friendlyStatus(booking.status)} />
                  <DetailValue
                    label="Created"
                    value={`${formatDate(booking.createdAt)} · ${formatTime(booking.createdAt)}`}
                  />
                </View>

                <View className="mt-6 rounded-lg bg-slate-50 dark:bg-canvas px-4 py-3">
                  <Text className="text-sm font-medium text-secondary dark:text-primary">
                    {STATUS_EXPLANATIONS[booking.status] ??
                      `This booking is ${friendlyStatus(booking.status).toLocaleLowerCase()}.`}
                  </Text>
                </View>

                {CANCELLABLE_STATUSES.includes(booking.status) ? (
                  <View className="mt-5 border-t border-hairline dark:border-hairline-strong pt-5">
                    {cancelPrompt ? (
                      <View className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                        <Text className="text-sm font-semibold text-primary">
                          Cancel this booking?
                        </Text>
                        <Text className="mt-1 text-sm text-secondary">
                          You can cancel until the professional starts travelling. The professional
                          will be notified.
                        </Text>
                        <View className="mt-3 flex-row flex-wrap gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: cancelling, busy: cancelling }}
                            disabled={cancelling}
                            onPress={() => void cancelBooking()}
                            className="min-h-11 justify-center rounded-lg bg-rose-700 px-4"
                          >
                            {cancelling ? (
                              <ActivityIndicator color="#ffffff" />
                            ) : (
                              <Text className="font-semibold text-white">Confirm cancellation</Text>
                            )}
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={cancelling}
                            onPress={() => setCancelPrompt(false)}
                            className="min-h-11 justify-center rounded-lg border border-hairline-strong px-4"
                          >
                            <Text className="font-semibold text-secondary dark:text-primary">
                              Keep booking
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setCancelPrompt(true)}
                        className="min-h-11 self-start justify-center rounded-lg border border-rose-300 px-4 dark:border-rose-800"
                      >
                        <Text className="font-semibold text-rose-800 dark:text-rose-300">
                          Cancel booking
                        </Text>
                      </Pressable>
                    )}
                    {cancelError ? (
                      <Text
                        accessibilityRole="alert"
                        className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                      >
                        {cancelError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {REBOOKABLE_STATUSES.includes(booking.status) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push(
                        `/customer/bookings/new?professionalId=${encodeURIComponent(booking.professional.id)}&serviceId=${encodeURIComponent(booking.service.id)}`,
                      )
                    }
                    className="mt-5 min-h-11 self-start justify-center rounded-lg bg-brand-800 px-4"
                  >
                    <Text className="font-semibold text-white">Book this service again</Text>
                  </Pressable>
                ) : null}

                {completion ? (
                  <View className="mt-5 border-t border-hairline dark:border-hairline-strong pt-5">
                    <Text className="text-sm font-semibold text-primary">Completion</Text>
                    <CompletionLines state={completion} viewer="customer" />
                    {completion.awaitingViewerConfirmation &&
                    booking.status === 'COMPLETED_BY_PROFESSIONAL' ? (
                      <>
                        <Text className="mt-3 text-sm text-secondary">
                          Confirm that the work is finished to complete this booking.
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ disabled: confirming, busy: confirming }}
                          disabled={confirming}
                          onPress={confirmCompletion}
                          className="mt-4 min-h-12 items-center justify-center rounded-lg bg-brand-800 px-5"
                        >
                          {confirming ? (
                            <ActivityIndicator color="#ffffff" />
                          ) : (
                            <Text className="font-semibold text-white">Confirm completion</Text>
                          )}
                        </Pressable>
                      </>
                    ) : null}
                    {completion.awaitingViewerConfirmation &&
                    booking.status !== 'COMPLETED_BY_PROFESSIONAL' ? (
                      <Text className="mt-3 text-sm text-secondary">
                        The professional has not marked this job complete yet.
                      </Text>
                    ) : null}
                    {confirmError ? (
                      <Text
                        accessibilityRole="alert"
                        className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                      >
                        {confirmError}
                      </Text>
                    ) : null}
                  </View>
                ) : booking.status === 'COMPLETED_BY_PROFESSIONAL' ? (
                  // The booking reached the completed state but the completion
                  // record could not be read. Offer the action rather than hiding
                  // it; the server remains the authority on whether it is allowed.
                  <View className="mt-5 border-t border-hairline dark:border-hairline-strong pt-5">
                    <Text className="text-sm text-secondary">
                      Confirm that the work is finished to complete this booking.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: confirming, busy: confirming }}
                      disabled={confirming}
                      onPress={confirmCompletion}
                      className="mt-4 min-h-12 items-center justify-center rounded-lg bg-brand-800 px-5"
                    >
                      {confirming ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Text className="font-semibold text-white">Confirm completion</Text>
                      )}
                    </Pressable>
                    {confirmError ? (
                      <Text
                        accessibilityRole="alert"
                        className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                      >
                        {confirmError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {CLOSABLE_STATUSES.includes(booking.status) ? (
                  <View className="mt-5 border-t border-hairline dark:border-hairline-strong pt-5">
                    {closePrompt ? (
                      <View className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                        <Text className="text-sm font-semibold text-primary">
                          Close this booking?
                        </Text>
                        <Text className="mt-1 text-sm text-secondary">
                          Payment has settled and the work is done. Closing is final and moves this
                          booking to closed.
                        </Text>
                        <View className="mt-3 flex-row flex-wrap gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: closing, busy: closing }}
                            disabled={closing}
                            onPress={() => void closeBooking()}
                            className="min-h-11 justify-center rounded-lg bg-brand-800 px-4"
                          >
                            {closing ? (
                              <ActivityIndicator color="#ffffff" />
                            ) : (
                              <Text className="font-semibold text-white">Confirm close</Text>
                            )}
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={closing}
                            onPress={() => setClosePrompt(false)}
                            className="min-h-11 justify-center rounded-lg border border-hairline-strong px-4"
                          >
                            <Text className="font-semibold text-secondary dark:text-primary">
                              Keep open
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setClosePrompt(true)}
                        className="min-h-11 self-start justify-center rounded-lg bg-brand-800 px-4"
                      >
                        <Text className="font-semibold text-white">Close booking</Text>
                      </Pressable>
                    )}
                    {closeError ? (
                      <Text
                        accessibilityRole="alert"
                        className="mt-3 text-sm text-rose-800 dark:text-rose-300"
                      >
                        {closeError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <ReschedulePanel bookingId={booking.id} />

                <CustomerBookingTimeline
                  key={`${booking.id}:${booking.status}`}
                  bookingId={booking.id}
                />

                <BookingChatPanel
                  bookingId={booking.id}
                  readOnly={TERMINAL_BOOKING_STATUSES.includes(booking.status)}
                  readOnlyReason="This booking is closed, so the conversation is read-only."
                />

                {PAYMENT_STATUSES.includes(booking.status) ? (
                  <BookingPaymentPanel bookingId={booking.id} />
                ) : null}

                {LOCATION_STATUSES.includes(booking.status) ? (
                  <ProfessionalLocationPanel bookingId={booking.id} />
                ) : null}

                {REVIEWABLE_STATUSES.includes(booking.status) ? (
                  <LeaveReviewPanel
                    bookingId={booking.id}
                    canReview={booking.status !== 'COMPLETED_BY_PROFESSIONAL'}
                    existingReviewId={booking.reviewId ?? null}
                  />
                ) : null}

                <DisputePanel bookingId={booking.id} />
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </AuthenticatedRoleScreen>
  );
}

function formatLocation(booking: CustomerBooking) {
  if (!booking.location) return 'Location not provided';
  return [
    booking.location.label,
    booking.location.line1,
    booking.location.line2,
    `${booking.location.city}, ${booking.location.state} ${booking.location.postalCode}`,
  ]
    .filter(Boolean)
    .join(', ');
}

function StatusLabel({ status }: { status: CustomerBooking['status'] }) {
  /*
   * One shared pill, so the label colour lands on the Text. The previous local
   * version split a class string on a space and put the colour on the container
   * View, which React Native Web does not propagate - the label rendered black.
   */
  const tone =
    status === 'REQUESTED'
      ? 'pending'
      : status === 'REJECTED' || status === 'CANCELLED' || status === 'DISPUTED'
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

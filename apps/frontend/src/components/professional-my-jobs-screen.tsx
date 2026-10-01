import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  EmptyBlock,
  ErrorBlock,
  formatDate,
  formatTime,
  LoadingBlock,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { StatusPill } from '@/components/ui';
import { api } from '@/lib/api';

type ProfessionalBooking = Awaited<ReturnType<typeof api.professionalBookings.get>>;

/**
 * "My Jobs": every booking assigned to this professional, grouped by what they
 * can act on right now.
 *
 * The groups come from the server, not from a client-side guess, so a booking
 * cannot appear under "action needed" after the server has already moved it on.
 */
export function ProfessionalMyJobsScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    data: Awaited<ReturnType<typeof api.professionalJobs.list>> | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const current = result?.request === reload;
  const loadedJobs = current ? result.data : null;
  const jobs = loadedJobs ?? { upcoming: [], active: [], completed: [] };
  const error = current && result.error;

  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.professionalJobs
        .list(controller.signal)
        .then((data) => setResult({ request: reload, data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ request: reload, data: null, error: true });
        });
      return () => controller.abort();
    }, [reload]),
  );

  const totalCount = loadedJobs
    ? loadedJobs.upcoming.length + loadedJobs.active.length + loadedJobs.completed.length
    : null;

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScreenShell>
        <SectionHeading
          title="My Jobs"
          onBack={() => router.replace('/professional')}
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
          {totalCount === null
            ? 'Loading the jobs assigned to you.'
            : totalCount === 0
              ? 'No jobs are assigned to you yet.'
              : `${totalCount} job${totalCount === 1 ? '' : 's'} assigned to you.`}
        </Text>

        {loadedJobs === null && !error ? (
          <LoadingBlock label="Loading your jobs..." />
        ) : error ? (
          <ErrorBlock onRetry={load} />
        ) : totalCount === 0 ? (
          <EmptyBlock
            title="No jobs yet"
            detail="When a customer requests one of your services and you accept, the job appears here."
            actionLabel="Back to dashboard"
            onAction={() => router.replace('/professional')}
          />
        ) : (
          <View className="mt-6 gap-8">
            <JobGroup
              title="Needs your decision"
              subtitle="These customers are waiting for you to accept or decline."
              bookings={jobs.upcoming}
              emptyText="Nothing is waiting on you right now."
              onOpen={(id) => router.push(`/professional/bookings/${id}`)}
            />
            <JobGroup
              title="In progress"
              subtitle="Accepted and scheduled work, including jobs you are on the way to."
              bookings={jobs.active}
              emptyText="No scheduled jobs."
              onOpen={(id) => router.push(`/professional/bookings/${id}`)}
            />
            <JobGroup
              title="Completed"
              subtitle="Work you finished. Customer confirmation and payment may still be pending."
              bookings={jobs.completed}
              emptyText="No completed jobs yet."
              onOpen={(id) => router.push(`/professional/bookings/${id}`)}
            />
          </View>
        )}
      </ScreenShell>
    </RoleScreen>
  );
}

function JobGroup({
  title,
  subtitle,
  bookings,
  emptyText,
  onOpen,
}: {
  title: string;
  subtitle: string;
  bookings: ProfessionalBooking[];
  emptyText: string;
  onOpen: (bookingId: string) => void;
}) {
  return (
    <View>
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-xl font-bold text-primary">{title}</Text>
        <Text className="text-sm text-muted">{bookings.length}</Text>
      </View>
      <Text className="mt-1 text-sm text-secondary">{subtitle}</Text>
      {bookings.length === 0 ? (
        <View className="mt-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-6">
          <Text className="text-sm text-secondary">{emptyText}</Text>
        </View>
      ) : (
        <View className="mt-3 gap-3">
          {bookings.map((booking) => (
            <Pressable
              key={booking.id}
              accessibilityRole="button"
              accessibilityLabel={`${booking.service.title} for ${booking.customer.fullName}`}
              onPress={() => onOpen(booking.id)}
              className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5 active:border-brand-700"
            >
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View className="min-w-48 flex-1">
                  <Text className="text-base font-bold text-primary">{booking.service.title}</Text>
                  <Text className="mt-1 text-sm text-secondary">{booking.customer.fullName}</Text>
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
              {booking.location ? (
                <Text className="mt-2 text-xs text-muted">
                  {[
                    booking.location.label,
                    booking.location.city,
                    booking.location.state,
                    booking.location.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function StatusLabel({ status }: { status: ProfessionalBooking['status'] }) {
  const label = status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  // Shared pill, so the label colour lands on the Text rather than the container.
  const tone =
    status === 'REQUESTED'
      ? 'pending'
      : status === 'REJECTED' || status === 'CANCELLED' || status === 'DISPUTED'
        ? 'error'
        : status === 'IN_PROGRESS' || status === 'ON_THE_WAY'
          ? 'neutral'
          : status === 'CUSTOMER_CONFIRMED'
            ? 'success'
            : 'neutral';
  return <StatusPill label={label} tone={tone} />;
}

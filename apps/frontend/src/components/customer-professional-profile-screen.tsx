import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { ReportProfessionalPanel } from '@/components/report-professional-panel';
import { StatusBadge, VerifiedBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { clearAuthSession, writePendingAuthRedirect } from '@/lib/auth-session';
import { useAuthSession } from '@/lib/hooks';
import { formatMoney, UserAvatar } from '@/components/marketplace-ui';

type ProfessionalProfile = Awaited<ReturnType<typeof api.customerDiscovery.getProfessionalProfile>>;

function verificationTone(status: ProfessionalProfile['verification']) {
  if (status === 'VERIFIED') return 'success' as const;
  if (status === 'REJECTED') return 'error' as const;
  if (status === 'PENDING') return 'pending' as const;
  return 'neutral' as const;
}

/**
 * A professional's public profile, as a customer sees it.
 *
 * Everything on this screen is a value the server returned for this
 * professional. The verified mark is driven by the real `verification` column
 * alone - never by the business name, the number of services or seed data - so
 * an unverified professional is never shown a verified badge.
 */
export function CustomerProfessionalProfileScreen() {
  const router = useRouter();
  const { professionalId } = useLocalSearchParams<{ professionalId: string }>();
  const [profileResult, setProfileResult] = useState<{
    key: string;
    data: ProfessionalProfile | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = `${professionalId ?? ''}:${retry}`;
  const profile = profileResult?.key === requestKey ? profileResult.data : null;
  const loading = Boolean(professionalId) && profileResult?.key !== requestKey;
  const error = !professionalId || (profileResult?.key === requestKey && profileResult.error);
  const session = useAuthSession();

  useEffect(() => {
    if (!professionalId) return;
    const controller = new AbortController();
    api.customerDiscovery
      .getProfessionalProfile(professionalId, controller.signal)
      .then((data) => setProfileResult({ key: requestKey, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setProfileResult({ key: requestKey, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [professionalId, requestKey]);

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  const handleBookService = (serviceId: string) => {
    if (!session) {
      writePendingAuthRedirect(
        `/customer/bookings/new?professionalId=${encodeURIComponent(professionalId ?? '')}&serviceId=${encodeURIComponent(serviceId)}`,
      );
      router.push('/login');
      return;
    }

    router.push({
      pathname: '/customer/bookings/new',
      params: { professionalId: professionalId ?? '', serviceId },
    });
  };

  const verified = profile?.verification === 'VERIFIED';

  return (
    <View className="flex-1 bg-slate-50 dark:bg-canvas">
      <CustomerMarketplaceHeader
        customerName={session?.user.fullName ?? 'Guest'}
        onHomePress={() => router.replace(session ? '/customer' : '/')}
        onLogout={session ? logout : undefined}
        guest={!session}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to professionals"
            onPress={() => router.back()}
            className="mb-5 self-start"
          >
            <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
              ← Back to professionals
            </Text>
          </Pressable>
          {loading ? (
            <View className="min-h-36 flex-row items-center justify-center gap-3 rounded-xl border border-hairline bg-surface dark:border-hairline-strong">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading profile...</Text>
            </View>
          ) : error || !profile ? (
            <View className="rounded-xl border border-rose-200 bg-surface px-5 py-6 dark:border-rose-900">
              <Text className="text-base font-semibold text-primary">
                Something went wrong. Try again.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading this profile"
                onPress={() => setRetry((value) => value + 1)}
                className="mt-3 self-start"
              >
                <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View className="rounded-2xl border border-hairline bg-surface p-6 dark:border-hairline-strong sm:p-8">
                <View className="flex-row flex-wrap items-start gap-4">
                  {/* The real photo, or the name's initials - never a stock image. */}
                  <UserAvatar
                    avatarUrl={profile.avatarUrl}
                    name={profile.businessName || profile.fullName}
                    size={96}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                      Professional profile
                    </Text>
                    <Text className="mt-2 text-3xl font-black text-primary">
                      {profile.businessName}
                    </Text>
                    <Text className="mt-1 text-base text-secondary">{profile.fullName}</Text>
                    {/*
                      A verified professional gets the shared badge. Anything
                      else shows its actual state, so the profile never implies a
                      check that has not happened.
                    */}
                    <View className="mt-3">
                      {verified ? (
                        <VerifiedBadge />
                      ) : (
                        <StatusBadge
                          label={profile.verification.replace('_', ' ')}
                          tone={verificationTone(profile.verification)}
                        />
                      )}
                    </View>
                  </View>
                </View>
                {profile.serviceArea ? (
                  <Text className="mt-5 text-sm text-secondary dark:text-primary">
                    Service area: {profile.serviceArea}
                  </Text>
                ) : null}
                {/*
                  Experience is only stated when the professional actually gave a
                  number - a missing value is never replaced with a guess.
                */}
                {profile.yearsOfExperience !== undefined && profile.yearsOfExperience !== null ? (
                  <Text className="mt-2 text-sm text-secondary dark:text-primary">
                    {profile.yearsOfExperience} year
                    {profile.yearsOfExperience === 1 ? '' : 's'} of experience
                  </Text>
                ) : null}
                {/* The server only returns a phone when the professional made it visible. */}
                {profile.phone ? (
                  <Text className="mt-2 text-sm text-secondary dark:text-primary">
                    Phone: {profile.phone}
                  </Text>
                ) : null}
                {profile.contactEmail ? (
                  <Text className="mt-2 text-sm text-secondary dark:text-primary">
                    Contact: {profile.contactEmail}
                  </Text>
                ) : null}
                {profile.completedCount > 0 ? (
                  <Text className="mt-2 text-sm text-secondary dark:text-primary">
                    {profile.completedCount} completed job
                    {profile.completedCount === 1 ? '' : 's'}
                  </Text>
                ) : (
                  <Text className="mt-2 text-sm text-secondary">No completed jobs yet.</Text>
                )}
                {/*
                  Ratings come only from real published reviews. A zero count is
                  stated plainly rather than being rendered as a 0.0 score.
                */}
                {profile.ratingCount &&
                profile.ratingCount > 0 &&
                profile.averageRating !== undefined ? (
                  <Text className="mt-2 text-sm font-medium text-secondary dark:text-primary">
                    {profile.averageRating.toFixed(1)} rating · {profile.ratingCount} review
                    {profile.ratingCount === 1 ? '' : 's'}
                  </Text>
                ) : (
                  <Text className="mt-2 text-sm text-secondary">No ratings yet.</Text>
                )}
                {profile.bio ? (
                  <Text className="mt-5 text-base leading-7 text-secondary dark:text-primary">
                    {profile.bio}
                  </Text>
                ) : null}
                <Text className="mt-5 text-sm font-semibold text-primary">Availability</Text>
                {profile.workingHours?.length ? (
                  <View className="mt-2 gap-1">
                    {profile.workingHours.map((hours) => (
                      <Text key={hours.day} className="text-sm text-secondary dark:text-primary">
                        {WEEKDAYS[hours.day]} · {hours.start}–{hours.end}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text className="mt-1 text-sm text-secondary">
                    Working hours haven&apos;t been shared.
                  </Text>
                )}
              </View>

              <Text className="mt-8 text-xl font-bold text-primary">Services</Text>
              {profile.offerings.length === 0 ? (
                <Text className="mt-3 rounded-xl border border-hairline bg-surface px-5 py-6 text-sm text-secondary dark:border-hairline-strong">
                  No active services are listed yet.
                </Text>
              ) : (
                <View className="mt-4 gap-3">
                  {profile.offerings.map((service) => (
                    <View
                      key={service.id}
                      className="rounded-xl border border-hairline bg-surface p-4 dark:border-hairline-strong"
                    >
                      <Text className="text-xs font-semibold text-brand-800 dark:text-brand-300">
                        {service.category.name}
                      </Text>
                      <Text className="mt-1 text-base font-semibold text-primary">
                        {service.title}
                      </Text>
                      {service.summary ? (
                        <Text className="mt-1 text-sm leading-5 text-secondary">
                          {service.summary}
                        </Text>
                      ) : null}
                      <Text className="mt-2 text-sm leading-5 text-secondary">
                        {service.description}
                      </Text>
                      <Text className="mt-3 text-sm font-semibold text-primary">
                        {formatMoney(service.priceAmount, service.currency)} ·{' '}
                        {service.durationMinutes} minutes
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Book ${service.title}`}
                        onPress={() => handleBookService(service.id)}
                        className="mt-4 min-h-11 items-center justify-center self-start rounded-lg bg-brand-800 px-4 dark:bg-brand-700"
                      >
                        <Text className="text-sm font-semibold text-white">Book Service</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              {profile.reviews.length > 0 ? (
                <View className="mt-8">
                  <Text className="text-xl font-bold text-primary">Customer reviews</Text>
                  <View className="mt-3 gap-3">
                    {profile.reviews.map((review) => (
                      <View
                        key={review.id}
                        className="rounded-xl border border-hairline bg-surface p-4 dark:border-hairline-strong"
                      >
                        <Text className="font-semibold text-primary">
                          {review.rating}/5 · {review.customerName}
                        </Text>
                        <Text className="mt-1 text-xs text-muted">
                          {review.serviceTitle} · {new Date(review.createdAt).toLocaleDateString()}
                        </Text>
                        {review.comment ? (
                          <Text className="mt-2 text-sm leading-5 text-secondary dark:text-primary">
                            {review.comment}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View className="mt-8">
                  <Text className="text-xl font-bold text-primary">Customer reviews</Text>
                  <Text className="mt-3 rounded-xl border border-hairline bg-surface px-5 py-6 text-sm text-secondary dark:border-hairline-strong">
                    No reviews yet.
                  </Text>
                </View>
              )}

              {/*
                The route carries the professional's user id, which is what a
                report is filed against, so this needs no extra lookup.
              */}
              <ReportProfessionalPanel professionalUserId={professionalId} />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

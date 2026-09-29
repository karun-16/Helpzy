import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { clearAuthSession, readAuthSession } from '@/lib/auth-session';

type ProfessionalProfile = Awaited<ReturnType<typeof api.customerDiscovery.getProfessionalProfile>>;

function verificationTone(status: ProfessionalProfile['verification']) {
  if (status === 'VERIFIED') return 'success' as const;
  if (status === 'REJECTED') return 'error' as const;
  if (status === 'PENDING') return 'pending' as const;
  return 'neutral' as const;
}

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
  const session = readAuthSession();

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

  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <View className="flex-1 bg-slate-50">
        <CustomerMarketplaceHeader
          customerName={session?.user.fullName ?? 'Customer'}
          onHomePress={() => router.replace('/customer')}
          onLogout={logout}
        />
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          <View className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="mb-5 self-start"
            >
              <Text className="text-sm font-semibold text-emerald-800">
                ← Back to professionals
              </Text>
            </Pressable>
            {loading ? (
              <View className="min-h-36 flex-row items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white">
                <ActivityIndicator color="#047857" />
                <Text className="text-sm text-slate-600">Loading profile...</Text>
              </View>
            ) : error || !profile ? (
              <View className="rounded-xl border border-rose-200 bg-white px-5 py-6">
                <Text className="text-base font-semibold text-slate-900">
                  Something went wrong. Try again.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((value) => value + 1)}
                  className="mt-3 self-start"
                >
                  <Text className="text-sm font-semibold text-emerald-800">Retry</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                  <View className="flex-row flex-wrap items-start justify-between gap-4">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-emerald-800">
                        Professional profile
                      </Text>
                      <Text className="mt-2 text-3xl font-black text-slate-900">
                        {profile.businessName}
                      </Text>
                      <Text className="mt-1 text-base text-slate-600">{profile.fullName}</Text>
                    </View>
                    <StatusBadge
                      label={profile.verification.replace('_', ' ')}
                      tone={verificationTone(profile.verification)}
                    />
                  </View>
                  {profile.serviceArea ? (
                    <Text className="mt-5 text-sm text-slate-700">
                      Service area: {profile.serviceArea}
                    </Text>
                  ) : null}
                  {profile.averageRating !== undefined && profile.ratingCount !== undefined ? (
                    <Text className="mt-2 text-sm font-medium text-slate-700">
                      {profile.averageRating.toFixed(1)} rating · {profile.ratingCount} reviews
                    </Text>
                  ) : null}
                  {profile.bio ? (
                    <Text className="mt-5 text-base leading-7 text-slate-700">{profile.bio}</Text>
                  ) : null}
                </View>

                <Text className="mt-8 text-xl font-bold text-slate-900">Services</Text>
                {profile.services.length === 0 ? (
                  <Text className="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
                    No active services are listed yet.
                  </Text>
                ) : (
                  <View className="mt-4 gap-3">
                    {profile.services.map((service) => (
                      <View
                        key={service.id}
                        className="rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <Text className="text-xs font-semibold text-emerald-800">
                          {service.category.name}
                        </Text>
                        <Text className="mt-1 text-base font-semibold text-slate-900">
                          {service.title}
                        </Text>
                        {service.summary ? (
                          <Text className="mt-1 text-sm leading-5 text-slate-600">
                            {service.summary}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  disabled
                  className="mt-8 min-h-12 items-center justify-center rounded-xl bg-slate-300 px-5"
                >
                  <Text className="text-base font-semibold text-slate-600">
                    Booking coming later
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </AuthenticatedRoleScreen>
  );
}

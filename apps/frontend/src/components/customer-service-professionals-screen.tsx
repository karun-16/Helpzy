import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CustomerProfessional } from '@helpzy/types';

import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { ProfessionalCard } from '@/components/professional-card';
import { api } from '@/lib/api';
import { clearAuthSession } from '@/lib/auth-session';
import { useAuthSession, useMarketplaceLocation } from '@/lib/hooks';

type ServiceProfessionals = Awaited<
  ReturnType<typeof api.customerDiscovery.getProfessionalsForService>
>;

export function CustomerServiceProfessionalsScreen() {
  const router = useRouter();
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const [result, setResult] = useState<{
    key: string;
    data: ServiceProfessionals | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);

  /*
   * The selected marketplace city is part of this request's identity, exactly as it
   * is on the home screen. Folding the slug into `requestKey` means switching from
   * Tirupati to Vijayawada while sitting on this page re-fetches instead of
   * leaving the previous city's professionals on screen under the same service
   * heading.
   *
   * With no city chosen the request is sent without a location, which preserves
   * the pre-location behaviour for a direct link.
   */
  const location = useMarketplaceLocation();
  const locationSlug = location?.location.slug ?? null;
  const requestKey = `${serviceId ?? ''}:${locationSlug ?? ''}:${retry}`;
  const currentResult = result?.key === requestKey ? result.data : null;
  const loading = Boolean(serviceId) && result?.key !== requestKey;
  const error = !serviceId || (result?.key === requestKey && result.error);

  useEffect(() => {
    if (!serviceId) return;
    const controller = new AbortController();
    api.customerDiscovery
      .getProfessionalsForService(serviceId, controller.signal, locationSlug)
      .then((data) => setResult({ key: requestKey, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [requestKey, serviceId, locationSlug]);

  const session = useAuthSession();
  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-canvas">
      <CustomerMarketplaceHeader
        customerName={session?.user.fullName ?? 'Guest'}
        onHomePress={() => router.replace(session ? '/customer' : '/')}
        onLogout={session ? logout : undefined}
        guest={!session}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            className="mb-5 self-start"
          >
            <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
              ← Back to services
            </Text>
          </Pressable>
          {loading ? (
            <View className="min-h-36 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading professionals...</Text>
            </View>
          ) : error || !currentResult ? (
            <View className="rounded-xl border border-rose-200 dark:border-rose-900 bg-surface px-5 py-6">
              <Text className="text-base font-semibold text-primary">
                Something went wrong. Try again.
              </Text>
              <Pressable
                accessibilityRole="button"
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
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                {currentResult.service.category.name}
              </Text>
              <Text className="mt-1 text-3xl font-black text-primary">
                {currentResult.service.title}
              </Text>
              {currentResult.service.summary ? (
                <Text className="mt-2 max-w-2xl text-base leading-6 text-secondary">
                  {currentResult.service.summary}
                </Text>
              ) : null}
              <Text className="mt-8 text-xl font-bold text-primary">Available Professionals</Text>
              {location ? (
                <Text className="mt-1 text-sm text-secondary">
                  Showing professionals in {location.location.city}
                  {location.location.district !== location.location.city
                    ? `, ${location.location.district}`
                    : ''}
                  .
                </Text>
              ) : null}
              {currentResult.professionals.length === 0 ? (
                <Text className="mt-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-6 text-sm text-secondary">
                  {location
                    ? `No professionals offer this service in ${location.location.city} yet.`
                    : 'No professionals found for this service.'}
                </Text>
              ) : (
                <View className="mt-4 flex-row flex-wrap gap-3">
                  {currentResult.professionals.map((professional: CustomerProfessional) => (
                    <View key={professional.id} className="w-full sm:w-[calc(50%-0.375rem)]">
                      <ProfessionalCard
                        professional={professional}
                        serviceTitle={currentResult.service.title}
                        serviceSummary={currentResult.service.summary}
                        onViewProfile={() =>
                          router.push(`/customer/professionals/${professional.id}`)
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

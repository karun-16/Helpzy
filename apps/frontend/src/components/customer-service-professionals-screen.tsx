import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CustomerProfessional } from '@helpzy/types';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { ProfessionalCard } from '@/components/professional-card';
import { api } from '@/lib/api';
import { clearAuthSession, readAuthSession } from '@/lib/auth-session';

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
  const requestKey = `${serviceId ?? ''}:${retry}`;
  const currentResult = result?.key === requestKey ? result.data : null;
  const loading = Boolean(serviceId) && result?.key !== requestKey;
  const error = !serviceId || (result?.key === requestKey && result.error);

  useEffect(() => {
    if (!serviceId) return;
    const controller = new AbortController();
    api.customerDiscovery
      .getProfessionalsForService(serviceId, controller.signal)
      .then((data) => setResult({ key: requestKey, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [requestKey, serviceId]);

  const session = readAuthSession();
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
          <View className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="mb-5 self-start"
            >
              <Text className="text-sm font-semibold text-emerald-800">← Back to services</Text>
            </Pressable>
            {loading ? (
              <View className="min-h-36 flex-row items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white">
                <ActivityIndicator color="#047857" />
                <Text className="text-sm text-slate-600">Loading professionals...</Text>
              </View>
            ) : error || !currentResult ? (
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
                <Text className="text-sm font-semibold text-emerald-800">
                  {currentResult.service.category.name}
                </Text>
                <Text className="mt-1 text-3xl font-black text-slate-900">
                  {currentResult.service.title}
                </Text>
                {currentResult.service.summary ? (
                  <Text className="mt-2 max-w-2xl text-base leading-6 text-slate-600">
                    {currentResult.service.summary}
                  </Text>
                ) : null}
                <Text className="mt-8 text-xl font-bold text-slate-900">
                  Available Professionals
                </Text>
                {currentResult.professionals.length === 0 ? (
                  <Text className="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
                    No professionals found for this service.
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
    </AuthenticatedRoleScreen>
  );
}

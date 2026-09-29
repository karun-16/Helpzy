import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { CustomerProfessionalProfile } from '@helpzy/types';

import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { ProfessionalCard } from '@/components/professional-card';
import { api } from '@/lib/api';
import { clearAuthSession, readAuthSession } from '@/lib/auth-session';
import type { CustomerServiceCategories } from '@helpzy/api-client';

export function CustomerHomeScreen() {
  const router = useRouter();
  const session = readAuthSession();
  const [categoriesResult, setCategoriesResult] = useState<{
    request: number;
    data: CustomerServiceCategories;
    error: boolean;
  } | null>(null);
  const [professionalsResult, setProfessionalsResult] = useState<{
    request: number;
    data: CustomerProfessionalProfile[];
    error: boolean;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const categoriesCurrent = categoriesResult?.request === reload;
  const professionalsCurrent = professionalsResult?.request === reload;
  const categoriesLoading = !categoriesCurrent;
  const professionalsLoading = !professionalsCurrent;
  const categoriesError = categoriesCurrent && categoriesResult.error;
  const professionalsError = professionalsCurrent && professionalsResult.error;
  const categories = categoriesCurrent ? categoriesResult.data : [];
  const professionals = professionalsCurrent ? professionalsResult.data : [];

  useEffect(() => {
    const controller = new AbortController();
    api.customerDiscovery
      .getCategories(controller.signal)
      .then((data) => setCategoriesResult({ request: reload, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setCategoriesResult({ request: reload, data: [], error: true });
        }
      });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    api.customerDiscovery
      .getAvailableProfessionals(controller.signal)
      .then((data) => setProfessionalsResult({ request: reload, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setProfessionalsResult({ request: reload, data: [], error: true });
        }
      });
    return () => controller.abort();
  }, [reload]);

  const term = search.trim().toLocaleLowerCase();
  const filteredCategories = !term
    ? categories
    : categories.flatMap((category) => {
        const categoryMatches = `${category.name} ${category.description ?? ''}`
          .toLocaleLowerCase()
          .includes(term);
        const services = categoryMatches
          ? category.services
          : category.services.filter((service) =>
              `${service.title} ${service.summary ?? ''}`.toLocaleLowerCase().includes(term),
            );
        return services.length > 0 ? [{ ...category, services }] : [];
      });

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  return (
    <View className="flex-1 bg-slate-50">
      <CustomerMarketplaceHeader
        customerName={session?.user.fullName ?? 'Customer'}
        onHomePress={() => router.replace('/customer')}
        onLogout={logout}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <View className="mx-auto w-full max-w-6xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          <View className="rounded-2xl bg-emerald-950 px-6 py-8 sm:px-9 sm:py-10">
            <Text className="text-sm font-semibold text-emerald-200">Welcome back</Text>
            <Text className="mt-2 max-w-2xl text-3xl font-black text-white sm:text-4xl">
              What service do you need?
            </Text>
            <Text className="mt-3 max-w-xl text-base leading-6 text-emerald-100">
              Explore services and meet professionals who provide them.
            </Text>
            <View className="mt-6 flex-row items-center rounded-xl bg-white px-4 py-1">
              <Text className="mr-3 text-lg text-slate-400">⌕</Text>
              <TextInput
                accessibilityLabel="Search for a service"
                value={search}
                onChangeText={setSearch}
                placeholder="Search for a service..."
                placeholderTextColor="#64748b"
                className="min-h-12 flex-1 text-base text-slate-900"
              />
              {search ? (
                <Pressable accessibilityRole="button" onPress={() => setSearch('')}>
                  <Text className="px-2 py-3 text-sm font-semibold text-emerald-800">Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View className="mt-9 flex-row items-end justify-between gap-3">
            <View>
              <Text className="text-2xl font-bold text-slate-900">Popular services</Text>
              <Text className="mt-1 text-sm text-slate-600">
                Choose a service to see who offers it.
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setReload((value) => value + 1)}>
              <Text className="text-sm font-semibold text-emerald-800">Refresh</Text>
            </Pressable>
          </View>

          {categoriesLoading ? (
            <View className="mt-6 min-h-28 flex-row items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-slate-600">Loading services...</Text>
            </View>
          ) : categoriesError ? (
            <DiscoveryError onRetry={() => setReload((value) => value + 1)} />
          ) : filteredCategories.length === 0 ? (
            <View className="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-8">
              <Text className="text-base font-semibold text-slate-800">No services found</Text>
              <Text className="mt-1 text-sm text-slate-600">Try another service or category.</Text>
            </View>
          ) : (
            <View className="mt-6 gap-8">
              {filteredCategories.map((category) => (
                <View key={category.id}>
                  <View className="mb-3 flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                      {category.iconUrl ? (
                        <Image
                          source={{ uri: category.iconUrl }}
                          accessibilityLabel={`${category.name} category`}
                          className="h-10 w-10 rounded-lg"
                        />
                      ) : (
                        <Text className="text-lg font-bold text-emerald-900">
                          {category.name.charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-lg font-bold text-slate-900">{category.name}</Text>
                      {category.description ? (
                        <Text className="text-sm text-slate-600">{category.description}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View className="flex-row flex-wrap gap-3">
                    {category.services.map((service) => (
                      <Pressable
                        key={service.id}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push(`/customer/services/${service.id}/professionals`)
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white p-4 active:border-emerald-700 sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
                      >
                        <Text className="text-base font-semibold text-slate-900">
                          {service.title}
                        </Text>
                        {service.summary ? (
                          <Text className="mt-1 text-sm leading-5 text-slate-600" numberOfLines={2}>
                            {service.summary}
                          </Text>
                        ) : null}
                        <Text className="mt-4 text-sm font-semibold text-emerald-800">
                          View professionals →
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View className="mt-10 flex-row items-end justify-between gap-3">
            <View>
              <Text className="text-2xl font-bold text-slate-900">Available Professionals</Text>
              <Text className="mt-1 text-sm text-slate-600">
                Service-based discovery, with no distance estimates.
              </Text>
            </View>
          </View>
          {professionalsLoading ? (
            <View className="mt-5 min-h-24 flex-row items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-slate-600">Loading professionals...</Text>
            </View>
          ) : professionalsError ? (
            <DiscoveryError onRetry={() => setReload((value) => value + 1)} />
          ) : professionals.length === 0 ? (
            <View className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-6">
              <Text className="text-sm text-slate-600">No professionals are available yet.</Text>
            </View>
          ) : (
            <View className="mt-5 flex-row flex-wrap gap-3">
              {professionals.map((professional) => (
                <View key={professional.id} className="w-full sm:w-[calc(50%-0.375rem)]">
                  <ProfessionalCard
                    professional={professional}
                    serviceTitle={professional.services.map((service) => service.title).join(' · ')}
                    onViewProfile={() => router.push(`/customer/professionals/${professional.id}`)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DiscoveryError({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="mt-5 rounded-xl border border-rose-200 bg-white px-5 py-6">
      <Text className="text-base font-semibold text-slate-900">
        Something went wrong. Try again.
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} className="mt-3 self-start">
        <Text className="text-sm font-semibold text-emerald-800">Retry</Text>
      </Pressable>
    </View>
  );
}

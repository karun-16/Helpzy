import { useEffect, useRef, useState } from 'react';
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
import { PlatformNoticeBanner } from '@/components/platform-notice-banner';
import { ProfessionalCard } from '@/components/professional-card';
import { api } from '@/lib/api';
import { appConfig } from '@/lib/config';
import { clearAuthSession } from '@/lib/auth-session';
import { useViewer } from '@/lib/hooks';
import type { CustomerServiceCategories, PublicPlatformSettings } from '@helpzy/api-client';

/** First name only, so the greeting stays one line. Falls back to the full name. */
function firstName(fullName: string): string {
  const [first = ''] = fullName.trim().split(/\s+/);
  return first || fullName.trim();
}

export function CustomerHomeScreen({ publicMode = false }: { publicMode?: boolean }) {
  const router = useRouter();
  /**
   * The one answer to "who is here", shared with the header.
   *
   * Reading this instead of a separate session lookup is what stops the header
   * showing a signed-in customer while the hero underneath still offers "Log in"
   * and "Join as a Professional": both now render from the same values, so they
   * cannot disagree about the same render.
   */
  const viewer = useViewer();
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
  /*
   * The platform's own announcements and maintenance state.
   *
   * Fetched here rather than by the header because this screen is also the public
   * marketplace, and a visitor who has not signed in is exactly the person who
   * most needs to be told the platform is closed. A failure leaves it null, and
   * the banner renders nothing - the server still refuses a blocked action, so the
   * worst case is a missing notice rather than a broken one.
   */
  const [platformSettings, setPlatformSettings] = useState<PublicPlatformSettings | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    api.customerDiscovery
      .platformSettings(controller.signal)
      .then((data) => setPlatformSettings(data.publicView))
      .catch(() => {
        /* A banner is best-effort; the server enforces the same rules regardless. */
      });
    return () => controller.abort();
  }, []);

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

  // `/` is public, so a guest is expected there; `/customer` is the same
  // marketplace behind the role guard, where a guest is not signed in.
  const isGuest = viewer.isGuest;
  const homeRoute = publicMode ? '/' : '/customer';
  // The hero's "Browse services" action scrolls the list below rather than
  // routing away, so the marketplace stays the one surface.
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View className="flex-1 bg-canvas">
      <CustomerMarketplaceHeader
        customerName={viewer.name || (publicMode ? 'Guest' : 'Customer')}
        onHomePress={() => router.replace(homeRoute)}
        onLogout={isGuest ? undefined : logout}
        guest={isGuest}
      />
      <PlatformNoticeBanner settings={platformSettings} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <View className="mx-auto w-full max-w-6xl px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          {/*
            One brand tone for the hero instead of the near-black navy it used
            to be: the same `brand-800` the buttons and links use, so the page
            reads as one surface rather than a gradient of unrelated blues.
          */}
          <View className="rounded-2xl bg-brand-800 px-6 py-8 sm:px-9 sm:py-10">
            {/* Live session, so an edited name shows here immediately. */}
            <Text className="text-sm font-semibold text-brand-100">
              {viewer.isSignedIn
                ? `Welcome back, ${firstName(viewer.name)}`
                : 'Browse local services'}
            </Text>
            <Text className="mt-2 max-w-2xl text-3xl font-black text-white sm:text-4xl">
              What service do you need?
            </Text>
            <Text className="mt-3 max-w-xl text-base leading-6 text-brand-100">
              Explore services and meet professionals who provide them.
            </Text>
            {/*
              One set of calls to action per signed-in role, so a customer is
              never offered "Log in" and a professional is never offered a
              customer booking link. ADMIN is deliberately absent from the
              registration options: an administrator is provisioned, not
              self-selected, and the server enforces the same list.

              These chips use the `inverse*` tokens rather than `surface`. The
              hero panel is brand-800 in both themes, so a chip inside it has to
              stay light in both; `bg-surface` would have flipped to the dark
              surface and left dark-on-dark labels.
            */}
            <View className="mt-5 flex-row flex-wrap items-center gap-3">
              {viewer.isGuest ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Join as a Professional"
                    onPress={() => router.push('/register?role=PROFESSIONAL')}
                    className="min-h-11 justify-center rounded-lg bg-inverse px-4 active:bg-inverse-muted"
                  >
                    <Text className="text-sm font-bold text-inverse-text">
                      Join as a Professional
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Log in"
                    onPress={() => router.push('/login')}
                    className="min-h-11 justify-center rounded-lg border border-inverse-border px-4 active:bg-brand-900"
                  >
                    <Text className="text-sm font-semibold text-inverse">Log in</Text>
                  </Pressable>
                </>
              ) : viewer.role === 'PROFESSIONAL' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go to Professional Dashboard"
                  onPress={() => router.push('/professional')}
                  className="min-h-11 justify-center rounded-lg bg-inverse px-4 active:bg-inverse-muted"
                >
                  <Text className="text-sm font-bold text-inverse-text">
                    Professional Dashboard
                  </Text>
                </Pressable>
              ) : viewer.role === 'ADMIN' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go to Admin Dashboard"
                  onPress={() => router.push('/admin')}
                  className="min-h-11 justify-center rounded-lg bg-inverse px-4 active:bg-inverse-muted"
                >
                  <Text className="text-sm font-bold text-inverse-text">Admin Dashboard</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Browse services below"
                    onPress={() => scrollRef.current?.scrollTo({ y: 430, animated: true })}
                    className="min-h-11 justify-center rounded-lg bg-inverse px-4 active:bg-inverse-muted"
                  >
                    <Text className="text-sm font-bold text-inverse-text">Browse services</Text>
                  </Pressable>
                </>
              )}
            </View>
            {/*
              The search field sits on the dark panel, so it is an `inverse`
              surface with an explicitly dark label. A theme-following surface
              here would have vanished into the hero.
            */}
            <View className="mt-6 flex-row items-center gap-2 rounded-xl bg-inverse px-3 py-1">
              <Text accessibilityElementsHidden className="text-lg font-semibold text-slate-400">
                ⌕
              </Text>
              <TextInput
                accessibilityLabel="Search for a service"
                value={search}
                onChangeText={setSearch}
                placeholder="Search for a service..."
                className="min-h-12 flex-1 text-base text-slate-900"
              />
              {search ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                  className="min-h-10 justify-center px-2"
                >
                  <Text className="text-sm font-semibold text-inverse-text">Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View>
            <View className="mt-9 flex-row flex-wrap items-end justify-between gap-3">
              <View>
                <Text className="text-2xl font-bold text-primary">Popular services</Text>
                <Text className="mt-1 text-sm text-secondary">
                  Choose a service to see who offers it.
                </Text>
              </View>
              <View className="flex-row items-center gap-4">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh the marketplace"
                  onPress={() => setReload((value) => value + 1)}
                  className="min-h-10 justify-center"
                >
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    Refresh
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {categoriesLoading ? (
            <View className="mt-6 min-h-28 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading services...</Text>
            </View>
          ) : categoriesError ? (
            <DiscoveryError onRetry={() => setReload((value) => value + 1)} />
          ) : filteredCategories.length === 0 ? (
            <View className="mt-6 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-8">
              <Text className="text-base font-semibold text-primary">No services found</Text>
              <Text className="mt-1 text-sm text-secondary">Try another service or category.</Text>
            </View>
          ) : (
            <View className="mt-6 gap-8">
              {filteredCategories.map((category) => (
                <View key={category.id}>
                  <View className="mb-3 flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-950">
                      {category.iconUrl ? (
                        <Image
                          source={{ uri: category.iconUrl }}
                          accessibilityLabel={`${category.name} category`}
                          className="h-10 w-10 rounded-lg"
                        />
                      ) : (
                        <Text className="text-lg font-bold text-brand-900 dark:text-brand-200">
                          {category.name.charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-lg font-bold text-primary">{category.name}</Text>
                      {category.description ? (
                        <Text className="text-sm text-secondary">{category.description}</Text>
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
                        className="w-full rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-4 active:border-brand-700 sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
                      >
                        <Text className="text-base font-semibold text-primary">
                          {service.title}
                        </Text>
                        {service.summary ? (
                          <Text className="mt-1 text-sm leading-5 text-secondary" numberOfLines={2}>
                            {service.summary}
                          </Text>
                        ) : null}
                        <Text className="mt-4 text-sm font-semibold text-brand-800 dark:text-brand-300">
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
              <Text className="text-2xl font-bold text-primary">Available Professionals</Text>
              <Text className="mt-1 text-sm text-secondary">
                Service-based discovery, with no distance estimates.
              </Text>
            </View>
          </View>
          {professionalsLoading ? (
            <View className="mt-5 min-h-24 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
              <ActivityIndicator color="#047857" />
              <Text className="text-sm text-secondary">Loading professionals...</Text>
            </View>
          ) : professionalsError ? (
            <DiscoveryError onRetry={() => setReload((value) => value + 1)} />
          ) : professionals.length === 0 ? (
            <View className="mt-5 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-6">
              <Text className="text-sm text-secondary">No professionals are available yet.</Text>
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
    <View className="mt-5 rounded-xl border border-danger-soft bg-surface px-5 py-6">
      {/*
        Named rather than generic. An unreachable API and a blocked cross-origin
        request look identical from the browser, and "something went wrong"
        sends a developer looking for missing data instead of a server that is
        not running.
      */}
      <Text className="text-base font-semibold text-primary">
        Can&rsquo;t reach the HELPZY API at {appConfig.apiBaseUrl}.
      </Text>
      <Text className="mt-1 text-sm leading-5 text-secondary">
        Check that the API is running and that this page&rsquo;s origin is listed in
        API_CORS_ORIGINS.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry loading the marketplace"
        onPress={onRetry}
        className="mt-3 min-h-10 self-start justify-center"
      >
        <Text className="text-sm font-semibold text-action-text">Retry</Text>
      </Pressable>
    </View>
  );
}

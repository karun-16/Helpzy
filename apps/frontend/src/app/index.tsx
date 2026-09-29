import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HealthResponseDto } from '@helpzy/validation';

import { PrimaryButton, StatusBadge, type StatusTone } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { appConfig } from '@/lib/config';

type CheckState =
  | { phase: 'loading' }
  | { phase: 'success'; health: HealthResponseDto }
  | { phase: 'error'; message: string };

/**
 * PHASE 1 foundation screen.
 *
 * It proves, on every platform, that the single frontend codebase is wired to
 * the shared packages and to the API: one button, one typed request, one
 * response. Feature screens replace this from PHASE 5 onwards.
 */
export default function FoundationScreen() {
  const [state, setState] = useState<CheckState>({ phase: 'loading' });
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const health = await api.health.check(controller.signal);
      if (!controller.signal.aborted) setState({ phase: 'success', health });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        phase: 'error',
        message:
          error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      });
    }
  }, []);

  useEffect(() => {
    // The first state is already `loading`, so the effect only starts the
    // request. `runCheck` reaches its setState calls in a promise callback, not
    // synchronously in the effect body, which is what the rule below targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runCheck();
    return () => abortRef.current?.abort();
  }, [runCheck]);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    void runCheck();
  }, [runCheck]);

  const isLoading = state.phase === 'loading';

  return (
    <SafeAreaView className="flex-1 bg-slate-50" edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerClassName="w-full max-w-2xl self-center px-5 py-8 md:px-8 md:py-14"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="mb-8">
          <StatusBadge label="Phase 1 · Foundation" tone="pending" />
          <Text
            accessibilityRole="header"
            className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl"
          >
            {appConfig.appName}
          </Text>
          <Text className="mt-2 text-lg text-slate-600">{appConfig.appTagline}</Text>
        </View>

        <View className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <Text accessibilityRole="header" className="text-lg font-semibold text-slate-900">
            API status
          </Text>
          <Text className="mt-1 text-sm text-slate-600">
            One Expo codebase serving web, Android and iOS, talking to the NestJS API.
          </Text>

          <View className="mt-4 min-h-[104px] justify-center">
            <StatusPanel state={state} />
          </View>

          <View className="mt-4">
            <PrimaryButton
              label={isLoading ? 'Checking…' : 'Check API again'}
              onPress={retry}
              busy={isLoading}
            />
          </View>
        </View>

        <View className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
          <Text accessibilityRole="header" className="text-base font-semibold text-slate-900">
            Runtime
          </Text>
          <View className="mt-3 gap-2">
            <InfoRow label="Platform" value={describePlatform()} />
            <InfoRow label="API base URL" value={appConfig.apiBaseUrl} />
            <InfoRow label="Request timeout" value={`${appConfig.apiTimeoutMs} ms`} />
            <InfoRow label="Versioned prefix" value={`/${appConfig.apiGlobalPrefix}`} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPanel({ state }: { state: CheckState }) {
  if (state.phase === 'loading') {
    return (
      <View className="flex-row items-center gap-3">
        <StatusBadge label="Checking" tone="pending" />
        <Text className="text-sm text-slate-500">Contacting the API…</Text>
      </View>
    );
  }

  if (state.phase === 'error') {
    return (
      <View>
        <StatusBadge label="Unreachable" tone="error" />
        <Text className="mt-2 text-sm text-slate-700">{state.message}</Text>
      </View>
    );
  }

  const { health } = state;
  return (
    <View>
      <StatusBadge label={health.status} tone={toneFor(health.status)} />
      <Text className="mt-2 text-sm text-slate-700">
        {health.service} · {health.environment} · v{health.version}
      </Text>
      <View className="mt-2 gap-1">
        {health.checks.map((check) => (
          <View key={check.name} className="flex-row items-center justify-between gap-4">
            <Text className="text-xs text-slate-500">{check.name}</Text>
            <Text className="text-xs font-medium text-slate-700">
              {check.status} · {check.latencyMs.toFixed(1)} ms
            </Text>
          </View>
        ))}
      </View>
      {health.status === 'UP' ? null : (
        // `check.message` is written for operators reading the API logs and can
        // contain infrastructure detail, so it is deliberately not shown here.
        <Text className="mt-2 text-xs text-slate-500">
          The API is running but a dependency is unavailable. Check the API logs.
        </Text>
      )}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium text-slate-900">{value}</Text>
    </View>
  );
}

function toneFor(status: string): StatusTone {
  if (status === 'UP') return 'success';
  if (status === 'DEGRADED') return 'pending';
  return 'error';
}

function describePlatform(): string {
  return Platform.OS === 'web' ? 'Web (react-native-web)' : `${Platform.OS} ${Platform.Version}`;
}

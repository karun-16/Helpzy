import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { readThemePreference } from '@/lib/auth-session';

/**
 * Root navigator.
 *
 * The single owner of the applied colour scheme. The *preference* lives in
 * storage (see `useThemePreference`) and is applied here once, on mount, so a
 * dark-mode choice survives a refresh. Screens change the preference, they never
 * call `setColorScheme` themselves - two writers would let the UI and the stored
 * preference disagree.
 *
 * `contentStyle` is intentionally left without a hardcoded background: a fixed
 * hex here paints the light colour over the whole app and defeats the toggle.
 * Each screen's own root carries `bg-slate-50 dark:bg-canvas` instead.
 */
export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme(readThemePreference());
  }, [setColorScheme]);

  return (
    <SafeAreaProvider>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}
      />
    </SafeAreaProvider>
  );
}

import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Root navigator.
 *
 * Navigation groups are added per phase (`(auth)`, `(customer)`,
 * `(professional)`, `(admin)`). PHASE 1 only renders the foundation screen.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f8fafc' },
        }}
      />
    </SafeAreaProvider>
  );
}

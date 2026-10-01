import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { AdminDashboardScreen } from '@/components/admin-dashboard-screen';
import { api } from '@/lib/api';
import { buildDashboardRoute, writeAuthSession } from '@/lib/auth-session';
import { useAuthSession } from '@/lib/hooks';

export default function AdminRoute() {
  const router = useRouter();
  // Live session: completing MFA writes the new session, and this screen has to
  // see it without waiting for a navigation.
  const session = useAuthSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
      return;
    }
    if (session.user.role !== 'ADMIN') {
      router.replace(buildDashboardRoute(session.user.role));
    }
  }, [router, session]);

  if (!session) {
    return <View className="flex-1 bg-slate-50 dark:bg-canvas" />;
  }

  if (session.user.mfaVerified) {
    return (
      <AuthenticatedRoleScreen role="ADMIN">
        <AdminDashboardScreen />
      </AuthenticatedRoleScreen>
    );
  }

  const verifyMfa = async () => {
    setVerifying(true);
    setError(null);
    try {
      const response = await api.auth.verifyMfa({ code });
      // Written to the shared store, so the effect above and the dashboard both
      // react to the same session rather than to local component state.
      writeAuthSession({ token: response.token, user: response.user });
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : 'Unable to verify the second factor. Please try again.',
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4 dark:bg-canvas">
      <View className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 dark:border-hairline-strong">
        <Text className="text-2xl font-bold text-primary">Admin verification</Text>
        <Text className="mt-2 text-base text-secondary">
          Enter your second-factor code to continue.
        </Text>
        <TextInput
          accessibilityLabel="Second-factor code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="6-digit code"
          className="mt-5 min-h-12 rounded-xl border border-hairline-strong bg-surface-muted px-4 py-3 text-base text-primary"
        />
        {/*
          A filled action with a dedicated dark fill. It used to paint a
          theme-following brand colour while keeping white text, so the label
          vanished on the pale dark-mode brand.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Verify code"
          accessibilityState={{ busy: verifying, disabled: verifying }}
          disabled={verifying}
          onPress={verifyMfa}
          className={`mt-4 min-h-12 justify-center rounded-xl px-4 py-3 active:bg-action-fill-hover ${
            verifying ? 'bg-action-fill opacity-60' : 'bg-action-fill'
          }`}
        >
          <Text className="text-center text-base font-semibold text-white">
            {verifying ? 'Verifying...' : 'Verify code'}
          </Text>
        </Pressable>
        {error ? (
          <Text accessibilityRole="alert" className="mt-4 text-sm font-medium text-danger">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

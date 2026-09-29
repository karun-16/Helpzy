import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { api } from '@/lib/api';
import {
  buildDashboardRoute,
  readAuthSession,
  writeAuthSession,
  type AuthSession,
} from '@/lib/auth-session';

export default function AdminRoute() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(() => readAuthSession());
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
    return <View className="flex-1 bg-slate-50" />;
  }

  if (session.user.mfaVerified) {
    return <AuthenticatedRoleScreen role="ADMIN" />;
  }

  const verifyMfa = async () => {
    setVerifying(true);
    setError(null);
    try {
      const response = await api.auth.verifyMfa({ code });
      const nextSession = { token: response.token, user: response.user };
      writeAuthSession(nextSession);
      setSession(nextSession);
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
    <View className="flex-1 items-center justify-center bg-slate-50 px-4">
      <View className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
        <Text className="text-2xl font-bold text-slate-900">Admin verification</Text>
        <Text className="mt-2 text-base text-slate-600">
          Enter your second-factor code to continue.
        </Text>
        <TextInput
          accessibilityLabel="Second-factor code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="6-digit code"
          className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800"
        />
        <Pressable
          accessibilityRole="button"
          disabled={verifying}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-3"
          onPress={verifyMfa}
        >
          <Text className="text-center text-base font-semibold text-white">
            {verifying ? 'Verifying...' : 'Verify code'}
          </Text>
        </Pressable>
        {error ? <Text className="mt-4 text-sm text-red-700">{error}</Text> : null}
      </View>
    </View>
  );
}

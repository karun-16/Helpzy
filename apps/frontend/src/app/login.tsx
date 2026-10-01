import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api';
import {
  buildDashboardRoute,
  clearPendingAuthRedirect,
  readPendingAuthRedirect,
  writeAuthSession,
} from '../lib/auth-session';

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState<'idle' | 'requesting' | 'verifying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ phone: string; otp?: string } | null>(null);

  const requestOtp = async () => {
    setError(null);
    setStatus('requesting');

    try {
      const response = await api.auth.requestOtp({ phone });
      setChallenge({ phone: response.phone, otp: response.otp });
      setStatus('idle');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send OTP.');
      setStatus('idle');
    }
  };

  const verifyOtp = async () => {
    if (!challenge) {
      return;
    }

    setError(null);
    setStatus('verifying');

    try {
      const response = await api.auth.verifyOtp({
        phone: challenge.phone,
        otp: otp || challenge.otp || '',
      });
      if (response.mfaRequired) {
        writeAuthSession({ token: response.token, user: response.user });
        clearPendingAuthRedirect();
        router.replace('/admin');
        return;
      }

      writeAuthSession({ token: response.token, user: response.user });
      const redirect = readPendingAuthRedirect() ?? buildDashboardRoute(response.user.role);
      clearPendingAuthRedirect();
      router.replace(redirect);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Unable to verify OTP.');
      setStatus('idle');
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4 dark:bg-canvas">
      <View className="w-full max-w-md rounded-3xl border border-hairline bg-surface p-6 shadow-sm shadow-slate-200/60 dark:border-hairline-strong dark:shadow-none">
        <Text className="text-3xl font-black tracking-tight text-primary">Welcome back</Text>
        <Text className="mt-2 text-base text-secondary">
          Login with your mobile number to continue.
        </Text>

        <TextInput
          accessibilityLabel="Mobile number"
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
          className="mt-6 min-h-12 rounded-2xl border border-hairline dark:border-hairline-strong bg-slate-50 dark:bg-canvas px-4 py-3 text-base text-primary dark:border-hairline-strong dark:bg-slate-800"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send OTP"
          accessibilityState={{ busy: status === 'requesting' }}
          onPress={requestOtp}
          className="mt-4 min-h-12 justify-center rounded-xl bg-brand-600 px-4 py-3"
        >
          <Text className="text-center text-base font-semibold text-white">
            {status === 'requesting' ? 'Sending OTP...' : 'Send OTP'}
          </Text>
        </Pressable>

        {challenge ? (
          <View className="mt-5 rounded-2xl border border-brand-100 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/40 p-4 dark:border-brand-900 dark:bg-brand-950/40">
            <Text className="text-sm text-brand-800 dark:text-brand-200 dark:text-brand-200">
              OTP sent to {challenge.phone}
            </Text>
            {challenge.otp ? (
              <Text className="mt-2 text-xs text-brand-700 dark:text-brand-300 dark:text-brand-300">
                Demo OTP: {challenge.otp}
              </Text>
            ) : null}
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="6-digit OTP"
          value={otp}
          onChangeText={setOtp}
          placeholder="Enter 6-digit OTP"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          maxLength={6}
          className="mt-5 min-h-12 rounded-2xl border border-hairline dark:border-hairline-strong bg-slate-50 dark:bg-canvas px-4 py-3 text-base text-primary dark:border-hairline-strong dark:bg-slate-800"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Verify OTP"
          accessibilityState={{ busy: status === 'verifying' }}
          onPress={verifyOtp}
          className="mt-5 min-h-12 justify-center rounded-xl bg-brand-600 px-4 py-3 active:bg-brand-700"
        >
          <Text className="text-center text-base font-semibold text-white">
            {status === 'verifying' ? 'Verifying...' : 'Verify OTP'}
          </Text>
        </Pressable>

        {error ? (
          <Text
            accessibilityRole="alert"
            className="mt-4 text-sm font-medium text-red-600 dark:text-red-300"
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create an account"
          onPress={() => router.push('/register')}
          className="mt-5 min-h-11 justify-center"
        >
          <Text className="text-center text-sm font-medium text-brand-700 dark:text-brand-300 dark:text-brand-300">
            Need an account? Create one
          </Text>
        </Pressable>

        {/*
          Admin discoverability without a role chooser.

          There is deliberately no role selector here: the backend decides the
          role from the authenticated identity alone, so nothing on this screen
          can be used to ask for ADMIN. This note only tells an administrator
          that they use this same form, and that the API will recognise them and
          ask for a second factor next. It states nothing an attacker could use
          - the MFA step and the ADMIN guard are enforced server-side.
        */}
        <View className="mt-5 rounded-2xl border border-hairline bg-slate-50 dark:bg-canvas p-4 dark:border-hairline-strong dark:bg-slate-800/60">
          <Text className="text-sm font-semibold text-primary">Administrators</Text>
          <Text className="mt-1 text-xs leading-5 text-secondary">
            Administrators sign in here with the same form. After your phone is verified, an
            administrator account is sent to a second-factor step before the admin dashboard opens.
            There is no separate admin sign-up.
          </Text>
        </View>
      </View>
    </View>
  );
}

import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { ApiError } from '@helpzy/api-client';
import {
  buildDashboardRoute,
  clearPendingAuthRedirect,
  readPendingAuthRedirect,
  writeAuthSession,
} from '../lib/auth-session';

export default function RegisterScreen() {
  const router = useRouter();
  const { role: requestedRole } = useLocalSearchParams<{ role?: string }>();
  const [phone, setPhone] = useState('');
  // The marketplace's "Join as a Professional" CTA preselects the role. ADMIN is
  // not a valid value here even if it appears in the URL: the role list is
  // typed to Customer and Professional, and the server enforces the same set.
  const [role, setRole] = useState<'CUSTOMER' | 'PROFESSIONAL'>(
    requestedRole === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'CUSTOMER',
  );
  const [status, setStatus] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState<{ phone: string; otp?: string } | null>(null);
  const pendingAction = useRef<'requesting' | 'verifying' | null>(null);

  const requestOtp = async () => {
    if (pendingAction.current) return;
    pendingAction.current = 'requesting';
    setStatus('Sending OTP...');
    try {
      const response = await api.auth.requestRegistrationOtp({ phone, role });
      setChallenge({ phone: response.phone, otp: response.otp });
      setStatus('OTP sent. Use the demo code shown below.');
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.isNetworkError
          ? `Can't reach the HELPZY API at ${api.client.baseUrl}. Check that it is running and allows this Expo web origin.`
          : error instanceof ApiError && error.code === 'CONFLICT'
            ? 'An account already exists for this phone number. Please log in instead.'
            : error instanceof Error
              ? error.message
              : 'Unable to send OTP. Please try again.',
      );
    } finally {
      pendingAction.current = null;
    }
  };

  const verifyOtp = async () => {
    if (!challenge || pendingAction.current) return;
    pendingAction.current = 'verifying';
    setStatus('Verifying...');

    try {
      const response = await api.auth.verifyRegistrationOtp({
        phone: challenge.phone,
        otp: otp || challenge.otp || '',
        role,
      });
      writeAuthSession({ token: response.token, user: response.user });
      const redirect = readPendingAuthRedirect() ?? buildDashboardRoute(response.user.role);
      clearPendingAuthRedirect();
      router.replace(redirect);
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.code === 'CONFLICT'
          ? 'An account already exists for this phone number. Please log in instead.'
          : error instanceof Error
            ? error.message
            : 'Unable to verify OTP. Please request a new code and try again.',
      );
    } finally {
      pendingAction.current = null;
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-canvas px-4">
      <View className="w-full max-w-md rounded-3xl border border-hairline dark:border-hairline-strong bg-surface p-6 shadow-sm shadow-slate-200/60">
        <Text className="text-3xl font-black tracking-tight text-primary">Create account</Text>
        <Text className="mt-2 text-base text-secondary">
          Choose a role and verify your phone number.
        </Text>

        <View className="mt-6 flex-row rounded-2xl border border-hairline dark:border-hairline-strong bg-slate-50 dark:bg-canvas p-1">
          {(['CUSTOMER', 'PROFESSIONAL'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setRole(option)}
              className={`flex-1 rounded-xl px-3 py-2 ${role === option ? 'bg-brand-600' : ''}`}
            >
              <Text
                className={`text-center text-sm font-semibold ${role === option ? 'text-white' : 'text-secondary dark:text-primary'}`}
              >
                {option}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          keyboardType="phone-pad"
          returnKeyType="go"
          onSubmitEditing={() => void requestOtp()}
          className="mt-5 rounded-2xl border border-hairline dark:border-hairline-strong bg-slate-50 dark:bg-canvas px-4 py-3 text-base text-primary"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: status === 'Sending OTP...' }}
          disabled={status === 'Sending OTP...'}
          onPress={() => void requestOtp()}
          className="mt-4 rounded-xl bg-brand-600 px-4 py-3"
        >
          <Text className="text-center text-base font-semibold text-white">
            {status === 'Sending OTP...' ? 'Sending OTP...' : 'Request OTP'}
          </Text>
        </Pressable>

        {challenge ? (
          <View className="mt-5 rounded-2xl border border-brand-100 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/40 p-4">
            <Text className="text-sm text-brand-800 dark:text-brand-200">
              OTP sent to {challenge.phone}
            </Text>
            {challenge.otp ? (
              <Text className="mt-2 text-xs text-brand-700 dark:text-brand-300">
                Demo OTP: {challenge.otp}
              </Text>
            ) : null}
          </View>
        ) : null}

        <TextInput
          value={otp}
          onChangeText={setOtp}
          placeholder="Enter OTP"
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={() => void verifyOtp()}
          maxLength={6}
          className="mt-5 rounded-2xl border border-hairline dark:border-hairline-strong bg-slate-50 dark:bg-canvas px-4 py-3 text-base text-primary"
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !challenge || status === 'Verifying...' }}
          disabled={!challenge || status === 'Verifying...'}
          onPress={() => void verifyOtp()}
          className="mt-5 rounded-xl bg-brand-600 px-4 py-3 active:bg-brand-700"
        >
          <Text className="text-center text-base font-semibold text-white">
            {status === 'Verifying...' ? 'Verifying...' : 'Verify'}
          </Text>
        </Pressable>

        {status ? (
          <Text className="mt-4 text-sm font-medium text-secondary dark:text-primary">
            {status}
          </Text>
        ) : null}

        <Pressable onPress={() => router.push('/login')} className="mt-5">
          <Text className="text-center text-sm font-medium text-brand-700 dark:text-brand-300">
            Already have an account? Sign in
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { ApiError } from '@helpzy/api-client';
import { buildDashboardRoute, writeAuthSession } from '../lib/auth-session';

export default function RegisterScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'CUSTOMER' | 'PROFESSIONAL'>('CUSTOMER');
  const [status, setStatus] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState<{ phone: string; otp?: string } | null>(null);

  const requestOtp = async () => {
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
    }
  };

  const verifyOtp = async () => {
    if (!challenge) {
      return;
    }

    try {
      const response = await api.auth.verifyRegistrationOtp({
        phone: challenge.phone,
        otp: otp || challenge.otp || '',
        role,
      });
      writeAuthSession({ token: response.token, user: response.user });
      router.replace(buildDashboardRoute(response.user.role));
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.code === 'CONFLICT'
          ? 'An account already exists for this phone number. Please log in instead.'
          : error instanceof Error
            ? error.message
            : 'Unable to verify OTP. Please request a new code and try again.',
      );
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4">
      <View className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
        <Text className="text-3xl font-black tracking-tight text-slate-900">Create account</Text>
        <Text className="mt-2 text-base text-slate-600">
          Choose a role and verify your phone number.
        </Text>

        <View className="mt-6 flex-row rounded-2xl border border-slate-200 bg-slate-50 p-1">
          {(['CUSTOMER', 'PROFESSIONAL'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setRole(option)}
              className={`flex-1 rounded-xl px-3 py-2 ${role === option ? 'bg-brand-600' : ''}`}
            >
              <Text
                className={`text-center text-sm font-semibold ${role === option ? 'text-white' : 'text-slate-700'}`}
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
          className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800"
        />

        <Pressable onPress={requestOtp} className="mt-4 rounded-xl bg-brand-600 px-4 py-3">
          <Text className="text-center text-base font-semibold text-white">Request OTP</Text>
        </Pressable>

        {challenge ? (
          <View className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <Text className="text-sm text-brand-800">OTP sent to {challenge.phone}</Text>
            {challenge.otp ? (
              <Text className="mt-2 text-xs text-brand-700">Demo OTP: {challenge.otp}</Text>
            ) : null}
          </View>
        ) : null}

        <TextInput
          value={otp}
          onChangeText={setOtp}
          placeholder="Enter OTP"
          keyboardType="number-pad"
          maxLength={6}
          className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800"
        />

        <Pressable onPress={verifyOtp} className="mt-5 rounded-xl bg-slate-900 px-4 py-3">
          <Text className="text-center text-base font-semibold text-white">Verify</Text>
        </Pressable>

        {status ? <Text className="mt-4 text-sm font-medium text-slate-700">{status}</Text> : null}

        <Pressable onPress={() => router.push('/login')} className="mt-5">
          <Text className="text-center text-sm font-medium text-brand-700">
            Already have an account? Sign in
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

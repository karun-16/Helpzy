import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { buildDashboardRoute, writeAuthSession } from '../lib/auth-session';

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
        router.replace('/admin');
        return;
      }

      writeAuthSession({ token: response.token, user: response.user });
      router.replace(buildDashboardRoute(response.user.role));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Unable to verify OTP.');
      setStatus('idle');
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4">
      <View className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
        <Text className="text-3xl font-black tracking-tight text-slate-900">Welcome back</Text>
        <Text className="mt-2 text-base text-slate-600">
          Login with your mobile number to continue.
        </Text>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          keyboardType="phone-pad"
          className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800"
        />

        <Pressable onPress={requestOtp} className="mt-4 rounded-xl bg-brand-600 px-4 py-3">
          <Text className="text-center text-base font-semibold text-white">
            {status === 'requesting' ? 'Sending OTP...' : 'Send OTP'}
          </Text>
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
          placeholder="Enter 6-digit OTP"
          keyboardType="number-pad"
          maxLength={6}
          className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800"
        />

        <Pressable onPress={verifyOtp} className="mt-5 rounded-xl bg-slate-900 px-4 py-3">
          <Text className="text-center text-base font-semibold text-white">
            {status === 'verifying' ? 'Verifying...' : 'Verify OTP'}
          </Text>
        </Pressable>

        {error ? <Text className="mt-4 text-sm font-medium text-red-600">{error}</Text> : null}

        <Pressable onPress={() => router.push('/register')} className="mt-5">
          <Text className="text-center text-sm font-medium text-brand-700">
            Need an account? Create one
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

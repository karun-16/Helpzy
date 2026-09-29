import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  buildDashboardRoute,
  clearAuthSession,
  readAuthSession,
  type AuthSession,
  type SessionRole,
} from '@/lib/auth-session';

export function AuthenticatedRoleScreen({
  role,
  children,
}: {
  role: SessionRole;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [session] = useState<AuthSession | null>(() => readAuthSession());

  useEffect(() => {
    if (!session) {
      router.replace('/login');
      return;
    }
    if (session.user.role !== role) {
      router.replace(buildDashboardRoute(session.user.role));
    }
  }, [role, router, session]);

  if (!session) {
    return <View className="flex-1 bg-slate-50" />;
  }

  if (children) {
    return <>{children}</>;
  }

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4">
      <View className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
        <Text className="text-2xl font-bold text-slate-900">Welcome, {session.user.fullName}</Text>
        <Text className="mt-2 text-base text-slate-600">{role} access is active.</Text>
        <Pressable
          accessibilityRole="button"
          className="mt-6 rounded-xl bg-slate-900 px-4 py-3"
          onPress={() => {
            clearAuthSession();
            router.replace('/');
          }}
        >
          <Text className="text-center text-base font-semibold text-white">Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}

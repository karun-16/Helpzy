import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { buildDashboardRoute, clearAuthSession, type SessionRole } from '@/lib/auth-session';
import { useAuthSession } from '@/lib/hooks';

export function AuthenticatedRoleScreen({
  role,
  children,
}: {
  role: SessionRole;
  children?: ReactNode;
}) {
  const router = useRouter();
  // Live session, so a cleared or refreshed session is enforced immediately
  // rather than only on the next navigation.
  const session = useAuthSession();

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
    return <View className="flex-1 bg-slate-50 dark:bg-canvas" />;
  }

  if (children) {
    return <>{children}</>;
  }

  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-4 dark:bg-canvas">
      <View className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 dark:border-hairline-strong">
        <Text className="text-2xl font-bold text-primary">Welcome, {session.user.fullName}</Text>
        <Text className="mt-2 text-base text-secondary">{role} access is active.</Text>
        <Pressable
          accessibilityRole="button"
          className="mt-6 rounded-xl bg-brand-600 px-4 py-3 active:bg-brand-700"
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

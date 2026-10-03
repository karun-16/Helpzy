import { Text } from 'react-native';
import { useRouter } from 'expo-router';

import {
  ActionButton,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
  ThemeControl,
} from '@/components/marketplace-ui';
import { clearAuthSession, type SessionRole } from '@/lib/auth-session';
import { resetUnreadCount } from '@/lib/notifications';

const ROLE_HOME: Record<'CUSTOMER' | 'PROFESSIONAL', '/customer' | '/professional'> = {
  CUSTOMER: '/customer',
  PROFESSIONAL: '/professional',
};

export function AccountSettingsScreen({ role }: { role: 'CUSTOMER' | 'PROFESSIONAL' }) {
  const router = useRouter();
  const homeRoute = ROLE_HOME[role];

  const logout = () => {
    resetUnreadCount();
    clearAuthSession();
    router.replace('/');
  };

  return (
    <RoleScreen
      role={role as SessionRole}
      homeRoute={homeRoute}
      onHome={() => router.replace(homeRoute)}
    >
      <ScreenShell>
        <SectionHeading title="Settings" onBack={() => router.replace(homeRoute)} />
        <Panel title="Appearance" subtitle="This preference is saved on this device.">
          <ThemeControl />
        </Panel>
        <Panel title="Privacy Policy">
          <Text className="text-sm leading-6 text-secondary">
            HELPZY uses the account, profile, address, booking and message information you provide
            to connect customers with local service professionals. Booking details are shared with
            the customer and assigned professional as needed to provide the requested service.
            Profile information displayed publicly is limited to the fields shown on the
            marketplace. The app does not currently configure push delivery or a third-party payment
            provider by default.
          </Text>
        </Panel>
        <Panel title="Terms and Conditions">
          <Text className="text-sm leading-6 text-secondary">
            Booking requests are subject to professional acceptance and scheduling. Customers may
            cancel before the professional starts travelling. Professionals are responsible for
            keeping service descriptions, availability and prices accurate. Reviews are available
            after eligible completed bookings and may be moderated before publication. Payment
            options depend on the capabilities configured for the booking.
          </Text>
        </Panel>
        <Panel title="About HELPZY">
          <Text className="text-sm leading-6 text-secondary">
            HELPZY helps customers discover local services, request appointments, communicate with
            the assigned professional and follow a booking through completion.
          </Text>
        </Panel>
        <Panel title="Account">
          <ActionButton label="Log out" tone="subtle" onPress={logout} />
        </Panel>
      </ScreenShell>
    </RoleScreen>
  );
}

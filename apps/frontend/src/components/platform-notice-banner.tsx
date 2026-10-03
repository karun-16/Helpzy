import { Linking, Text, View } from 'react-native';

import type { PublicPlatformSettings } from '@helpzy/api-client';

/**
 * What an admin told everyone at once: an announcement, and whether the platform
 * is mid-maintenance.
 *
 * Rendered above the marketplace rather than inside it, because both outrank the
 * content below. An announcement ("prices changed for Diwali") is information a
 * visitor needs before choosing anything; maintenance mode is the reason the
 * booking button is about to refuse, and finding that out by tapping it reads as a
 * bug.
 *
 * Nothing here is load-bearing: the server enforces maintenance mode on every
 * write regardless of what this shows, so a refused request still fails. That is
 * why a failed load renders nothing rather than an error - a banner saying
 * "settings could not load" tells a visitor nothing they can act on.
 *
 * Colours are the semantic tokens rather than severity hexes, so the banner is
 * legible in both themes without a `dark:` counterpart per surface.
 */
export function PlatformNoticeBanner({ settings }: { settings: PublicPlatformSettings | null }) {
  if (!settings) return null;

  const maintenanceMessage = settings.maintenanceMessage.trim();
  const announcementMessage = settings.announcementEnabled
    ? settings.announcementMessage.trim()
    : '';
  const supportEmail = settings.supportEmail.trim();

  if (!settings.maintenanceMode && !announcementMessage) return null;

  return (
    <View className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
      {settings.maintenanceMode ? (
        <View
          accessibilityRole="alert"
          className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3"
        >
          {/* An `alert`, because a notice a screen reader walks past is not one. */}
          <Text className="text-sm font-bold text-primary">
            {maintenanceMessage || 'HELPZY is under maintenance right now.'}
          </Text>
          <Text className="mt-1 text-sm text-secondary">
            You can still browse. Anything already booked is unaffected.
          </Text>
        </View>
      ) : null}

      {announcementMessage ? (
        <View
          accessibilityRole={settings.announcementSeverity === 'INFO' ? undefined : 'alert'}
          className={`mt-2 rounded-xl border px-4 py-3 ${
            settings.announcementSeverity === 'CRITICAL'
              ? 'border-danger/40 bg-danger-soft'
              : settings.announcementSeverity === 'WARNING'
                ? 'border-warning/40 bg-warning-soft'
                : 'border-hairline bg-surface'
          }`}
        >
          <Text className="text-sm text-primary">{announcementMessage}</Text>
        </View>
      ) : null}

      {supportEmail ? (
        <Text
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
          className="mt-2 text-xs text-muted"
        >
          Need help? Email {supportEmail}
        </Text>
      ) : null}
    </View>
  );
}

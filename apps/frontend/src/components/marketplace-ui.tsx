import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import helpzyLogo from '../../assets/helpzy.png';

import { Popover } from '@/components/popover';
import { PlatformNoticeBanner } from '@/components/platform-notice-banner';
import { appConfig, resolveMediaUrl } from '@/lib/config';
import { api } from '@/lib/api';
import { buildDashboardRoute, clearAuthSession, type SessionRole } from '@/lib/auth-session';
import {
  useAuthSession,
  useLoadableImage,
  useThemePreference,
  useViewer,
  initialsFor,
} from '@/lib/hooks';
import { resetUnreadCount, useUnreadCount } from '@/lib/notifications';
import type { ThemePreference } from '@/lib/auth-session';
import type { PublicPlatformSettings } from '@helpzy/api-client';

/**
 * Small building blocks shared by the marketplace screens.
 *
 * These exist so every screen renders loading, empty, error and money the same
 * way, and so no screen has to invent a placeholder value for data it has not
 * received.
 *
 * Every colour utility carries a `dark:` counterpart. The palette itself is
 * unchanged - only the light/dark value of the same token moves - so the app
 * switches appearance without a second design system.
 */

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string): string {
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/** `INR` renders as `₹1,499.00`; an unknown currency code is shown as-is. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function ScreenShell({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 bg-canvas">
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }}>
        <View className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View className="mt-4 min-h-28 flex-row items-center justify-center gap-3 rounded-xl border border-hairline bg-surface dark:border-hairline-strong">
      <ActivityIndicator color="#1550dc" />
      <Text className="text-sm text-secondary">{label}</Text>
    </View>
  );
}

export function EmptyBlock({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="mt-4 rounded-lg border border-hairline bg-surface px-5 py-6 shadow-sm shadow-slate-200/50 dark:border-hairline-strong dark:shadow-none">
      <Text className="text-base font-semibold text-primary">{title}</Text>
      <Text className="mt-1 text-sm leading-5 text-secondary">{detail}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          className="mt-4 min-h-11 justify-center self-start rounded-lg bg-brand-800 px-4 dark:bg-brand-700"
        >
          <Text className="font-semibold text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * An honest explanation when the API could not be reached.
 *
 * The generic "something went wrong" is actively unhelpful for the two causes a
 * developer actually hits: the API is not running, or the browser blocked the
 * request because this origin is not in `API_CORS_ORIGINS`. Both look identical
 * from here, so the message names the base URL to check rather than implying the
 * data itself is missing.
 */
function apiUnreachableMessage(): string {
  const base = appConfig.apiBaseUrl;
  return (
    `Can't reach the HELPZY API at ${base}. ` +
    "Check that it is running and that this page's origin is listed in API_CORS_ORIGINS."
  );
}

export function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="mt-4 rounded-xl border border-danger-soft bg-surface px-5 py-6">
      <Text className="font-semibold text-primary">{apiUnreachableMessage()}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="mt-3 min-h-11 self-start justify-center rounded-lg border border-hairline-strong px-4"
      >
        <Text className="text-sm font-semibold text-primary">Retry</Text>
      </Pressable>
    </View>
  );
}

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="mt-5 rounded-lg border border-hairline bg-surface p-5 shadow-sm shadow-slate-200/40 dark:border-hairline-strong dark:shadow-none">
      <Text className="text-base font-bold text-primary">{title}</Text>
      {subtitle ? <Text className="mt-1 text-sm text-secondary">{subtitle}</Text> : null}
      <View className="mt-4">{children}</View>
    </View>
  );
}

export function LabelledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'number-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** `false` renders a genuinely read-only field, not a field that ignores taps. */
  editable?: boolean;
}) {
  return (
    <View className="mt-4">
      <Text className="text-xs font-semibold uppercase text-muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        className={`mt-1 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-base text-primary dark:bg-slate-800 ${
          editable ? '' : 'opacity-60'
        } ${multiline ? 'min-h-24 align-top' : 'min-h-11'}`}
      />
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = 'primary',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'subtle';
  /** Set when the visible label repeats across a list, e.g. "Approve Acme". */
  accessibilityLabel?: string;
}) {
  const toneClass =
    tone === 'danger'
      ? 'bg-rose-700 dark:bg-rose-600'
      : tone === 'subtle'
        ? 'border border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
        : 'bg-brand-800 dark:bg-brand-700';
  const textClass = tone === 'subtle' ? 'text-primary dark:text-primary' : 'text-white';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      className={`mt-4 min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-5 ${
        /*
          Disabled state is a neutral fill with a readable secondary label, not a
          pale brand fill. `bg-brand-300` + `text-muted` only reached 2.6:1 in
          light mode and 3.9:1 in dark, which hid the label entirely.
        */
        disabled || busy ? 'bg-surface-muted dark:bg-slate-800' : toneClass
      }`}
    >
      {busy ? (
        <ActivityIndicator color={tone === 'subtle' ? '#334155' : '#ffffff'} size="small" />
      ) : null}
      <Text
        className={`font-semibold ${disabled || busy ? 'text-secondary dark:text-secondary' : textClass}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="mt-3 text-sm text-rose-800 dark:text-rose-300">
      {message}
    </Text>
  );
}

export function InlineSuccess({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      className="mt-3 text-sm font-medium text-emerald-800 dark:text-emerald-300"
    >
      {message}
    </Text>
  );
}

export function SectionHeading({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View className="flex-row flex-wrap items-end justify-between gap-3">
      <View className="flex-1">
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => (onBack ? onBack() : router.back())}
            className="mb-3 self-start"
          >
            <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">← Back</Text>
          </Pressable>
        ) : null}
        <Text className="text-3xl font-black text-primary">{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline justify-between gap-2 border-b border-hairline py-2 last:border-b-0 dark:border-hairline-strong">
      <Text className="text-sm text-secondary">{label}</Text>
      <Text className="text-sm font-semibold text-primary">{value}</Text>
    </View>
  );
}

/** The three theme choices, rendered identically wherever they are offered. */
export function ThemeControl() {
  const [preference, setPreference] = useThemePreference();

  return (
    <View>
      <Text className="text-sm font-semibold text-primary">Theme</Text>
      <Text className="mt-1 text-sm leading-5 text-secondary">
        Applies to the whole app and is remembered on this device.
      </Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label} theme`}
              onPress={() => setPreference(option.value)}
              className={`min-h-11 justify-center rounded-lg px-4 ${
                selected
                  ? 'bg-brand-800 dark:bg-brand-700'
                  : 'border border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-white' : 'text-secondary dark:text-primary'
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The real unread count, from the server.
 *
 * `null` means "not loaded yet" and renders no badge at all, so a slow or failed
 * request never shows a misleading zero.
 */
export function NotificationBell({ onPress }: { onPress: () => void }) {
  const { count } = useUnreadCount();
  const unread = count ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'
      }
      onPress={onPress}
      className="relative h-10 w-10 items-center justify-center rounded-full border border-hairline bg-surface-muted active:bg-surface-sunken"
    >
      {/*
        The colour lives on the glyph itself. React Native Web does not inherit
        `color` from a parent View into a Text, so an unclassed glyph falls back
        to the browser's black and disappears on a dark surface.
      */}
      <Text className="text-base text-primary">🔔</Text>
      {unread > 0 ? (
        /*
          A fixed saturated fill, not the `danger` token. That token is tuned as a
          *text* colour and becomes pale rose-300 in dark mode, which left white
          badge text sitting on a light pink dot.
        */
        <View className="absolute -right-1 -top-1 min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1">
          <Text className="text-[10px] font-bold text-inverse">
            {unread > 9 ? '9+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The user's own photo, or their initials. Never a stock placeholder image. */
export function UserAvatar({
  avatarUrl,
  name,
  size = 40,
}: {
  avatarUrl: string | null | undefined;
  name: string;
  size?: number;
}) {
  const initials = initialsFor(name);
  const resolvedUri = avatarUrl ? resolveMediaUrl(avatarUrl) : null;
  /*
   * Retries a bounded number of times before accepting the failure. Latching onto
   * the first error is what made a photo that had genuinely saved look like it
   * had not: one slow response put the avatar on initials for the rest of the
   * session, with nothing ever asking the server again.
   */
  const photo = useLoadableImage(resolvedUri);

  if (photo.uri) {
    return (
      <Image
        key={photo.attemptKey}
        source={{ uri: photo.uri }}
        accessibilityLabel={`${name} profile photo`}
        onError={photo.onError}
        style={{ height: size, width: size, borderRadius: size / 2 }}
        className="bg-surface-sunken dark:bg-slate-700"
      />
    );
  }

  return (
    <View
      accessibilityLabel={`${name}, no profile photo`}
      style={{ height: size, width: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-brand-100 dark:bg-brand-950 dark:bg-brand-900"
    >
      <Text
        className="font-bold text-brand-900 dark:text-brand-200 dark:text-brand-100"
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {initials || '?'}
      </Text>
    </View>
  );
}

/**
 * Navigation and account links for one role.
 *
 * Kept as data so the header, the mobile menu and the tests all agree on what
 * exists - a link cannot appear in the desktop bar and be missing from the
 * compact menu.
 */
/**
 * The permanent top-level navigation.
 *
 * Deliberately short. Bookings, notifications, addresses and settings live in
 * the avatar menu instead, so the header stays a marketplace bar rather than an
 * account console. `/` is the one marketplace surface every role shares, which
 * is why a professional can reach it from here too.
 */
function navigationFor(role: SessionRole): Array<{ label: string; route: string }> {
  if (role === 'CUSTOMER') {
    return [{ label: 'Marketplace', route: '/' }];
  }

  if (role === 'PROFESSIONAL') {
    return [
      { label: 'Marketplace', route: '/' },
      { label: 'Dashboard', route: '/professional' },
      { label: 'My Jobs', route: '/professional/my-jobs' },
      { label: 'Services', route: '/professional/services' },
      { label: 'Reviews', route: '/professional/reviews' },
    ];
  }

  return [];
}

/**
 * The avatar menu.
 *
 * These route to the screens that already exist - the menu is a way to reach
 * them, not a second implementation of any of them.
 */
function menuFor(role: SessionRole): Array<{ label: string; route: string }> {
  if (role === 'CUSTOMER') {
    return [
      { label: 'My Profile', route: '/customer/profile' },
      { label: 'My Bookings', route: '/customer/bookings' },
      { label: 'Saved Addresses', route: '/customer/addresses' },
      { label: 'Settings', route: '/customer/settings' },
    ];
  }

  if (role === 'PROFESSIONAL') {
    return [
      { label: 'My Profile', route: '/professional/profile' },
      { label: 'Verification', route: '/professional/verification' },
      { label: 'Settings', route: '/professional/settings' },
    ];
  }

  return [
    { label: 'Dashboard', route: '/admin' },
    { label: 'Verification queue', route: '/admin/verification' },
    { label: 'Settings', route: '/admin/settings' },
  ];
}

function notificationsRouteFor(role: SessionRole): string {
  return role === 'PROFESSIONAL' ? '/professional/notifications' : '/customer/notifications';
}

/**
 * The signed-in header: brand, role navigation, notification bell and an avatar
 * menu holding the account links and sign-out.
 *
 * The avatar menu is the single place these destinations live on small
 * screens, where the inline navigation is hidden - the customer should not have
 * to guess a URL to reach their bookings.
 */
export function MarketplaceHeader({
  homeRoute,
  onHome,
  onSignOut,
}: {
  homeRoute: '/' | '/customer' | '/professional' | '/admin';
  onHome: () => void;
  /**
   * Overrides the default sign-out for screens that already own the redirect.
   * The unread badge is still cleared first, so a caller cannot accidentally
   * leak the previous account's count.
   */
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const viewer = useViewer();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<View>(null);

  const role = viewer.role;
  const name = viewer.name || 'Signed in';
  const avatarUrl = viewer.avatarUrl;

  useEffect(() => {
    // The menu belongs to the screen that opened it; a route change closes it.
    return () => setMenuOpen(false);
  }, [homeRoute]);

  const logOut = () => {
    setMenuOpen(false);
    // The badge is per user, so it must not survive into the next sign-in.
    resetUnreadCount();
    clearAuthSession();
    if (onSignOut) {
      onSignOut();
      return;
    }
    router.replace('/');
  };

  const navigate = useCallback(
    (route: string) => {
      setMenuOpen(false);
      router.push(route);
    },
    [router],
  );

  return (
    <View className="sticky top-0 z-40 border-b border-hairline bg-surface">
      <View className="mx-auto w-full max-w-6xl flex-row flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="HELPZY home"
          onPress={onHome}
          className="flex-row items-center gap-2"
        >
          <Image
            source={helpzyLogo}
            accessibilityLabel="HELPZY logo"
            resizeMode="contain"
            style={{ width: 40, height: 32 }}
          />
          <Text className="text-2xl font-black text-primary">HELPZY</Text>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2 sm:gap-3">
          {role ? (
            <>
              {/* Inline links only where there is room; the avatar menu carries
                  the same destinations on a phone-sized layout. */}
              <View className="hidden flex-row items-center gap-1 sm:flex">
                {navigationFor(role).map((item) => (
                  <Pressable
                    key={item.route + item.label}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    onPress={() => navigate(item.route)}
                    className="min-h-10 justify-center rounded-lg px-2 active:bg-surface-muted dark:active:bg-slate-700"
                  >
                    <Text className="text-sm font-semibold text-secondary dark:text-primary">
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <NotificationBell onPress={() => navigate(notificationsRouteFor(role))} />

              <View className="hidden max-w-48 lg:flex">
                <Text className="text-right text-sm font-semibold text-primary" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="text-right text-xs text-muted">{roleLabel(role)}</Text>
              </View>

              <View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Account menu"
                  accessibilityState={{ expanded: menuOpen }}
                  onPress={() => setMenuOpen((open) => !open)}
                  ref={menuAnchorRef}
                >
                  <UserAvatar avatarUrl={avatarUrl} name={name} />
                </Pressable>
              </View>

              {/*
                Rendered through the anchored Popover rather than an absolutely
                positioned child of the header row. As a child it was clipped by
                the header's own bounds and covered the page content underneath;
                as a popover it is measured against the avatar, cannot be
                clipped by an ancestor, and stays inside the viewport.
              */}
              <Popover
                visible={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={menuAnchorRef}
                width={252}
                maxHeight={460}
                label="Account menu"
              >
                <View className="mb-1 border-b border-hairline pb-2 dark:border-hairline-strong">
                  <Text className="text-sm font-semibold text-primary" numberOfLines={1}>
                    {name}
                  </Text>
                  <Text className="text-xs text-muted">{roleLabel(role)}</Text>
                </View>
                {menuFor(role).map((item) => (
                  <Pressable
                    key={item.route + item.label}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    onPress={() => navigate(item.route)}
                    className="mt-1 min-h-10 justify-center rounded-lg px-3 active:bg-surface-muted dark:active:bg-slate-700"
                  >
                    <Text className="text-sm font-medium text-secondary dark:text-primary">
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
                {role === 'ADMIN' ? (
                  <>
                    <MenuThemeSwitch />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Log out"
                      onPress={logOut}
                      className="mt-2 min-h-10 justify-center rounded-lg border-t border-hairline px-3 pt-2 dark:border-hairline-strong"
                    >
                      <Text className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                        Log out
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </Popover>
            </>
          ) : (
            /*
              A guest still needs a way into the marketplace's two account
              types. This is the only place either is offered, so a signed-in
              visitor never sees them.
            */
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create an account"
                onPress={() => router.push('/register')}
                className="min-h-10 justify-center rounded-lg border border-hairline-strong px-3"
              >
                <Text className="text-sm font-semibold text-secondary dark:text-primary">
                  Sign up
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log in"
                onPress={() => router.push('/login')}
                className="min-h-10 justify-center rounded-lg bg-brand-700 px-3 active:bg-brand-800"
              >
                <Text className="text-sm font-semibold text-white">Log in</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * Theme inside the avatar menu.
 *
 * Reuses the one stored preference and the one `setColorScheme` writer, so
 * choosing a theme here is the same action as choosing it in Settings - not a
 * second mechanism that could disagree with the saved value.
 */
function MenuThemeSwitch() {
  const [preference, setPreference] = useThemePreference();

  return (
    <View className="mt-2 border-t border-hairline px-3 pt-2 dark:border-hairline-strong">
      <Text className="text-xs font-semibold uppercase text-muted">Theme</Text>
      <View className="mt-1.5 flex-row flex-wrap gap-1.5">
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label} theme`}
              onPress={() => setPreference(option.value)}
              className={`min-h-9 flex-1 justify-center rounded-lg px-2 ${
                selected
                  ? 'bg-brand-800 dark:bg-brand-700'
                  : 'border border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-surface'
              }`}
            >
              <Text
                numberOfLines={1}
                className={`text-xs font-semibold ${
                  selected ? 'text-white' : 'text-secondary dark:text-primary'
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function roleLabel(role: SessionRole): string {
  if (role === 'PROFESSIONAL') return 'Professional';
  if (role === 'ADMIN') return 'Administrator';
  return 'Customer';
}

/**
 * Wraps a screen in the shared header, page background and role guard.
 *
 * The role check is here rather than in each route file so a screen cannot
 * accidentally render for the wrong role; the redirect is an effect, so the
 * screen itself is never painted for someone who is not allowed to see it.
 */
export function RoleScreen({
  role,
  homeRoute,
  onHome,
  children,
}: {
  role: SessionRole;
  homeRoute: '/' | '/customer' | '/professional' | '/admin';
  onHome: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const session = useAuthSession();
  const [platformSettings, setPlatformSettings] = useState<PublicPlatformSettings | null>(null);

  /*
   * An admin's announcement and any maintenance mode belong above
   * every working screen, not just the customer marketplace, so a
   * professional about to book out a day or an admin mid-review
   * learns the same thing a browsing customer does. The banner is
   * best-effort: a failed load renders nothing, because the server
   * enforces maintenance mode on every write regardless of what is
   * shown here.
   */
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    api.customerDiscovery
      .platformSettings(controller.signal)
      .then((data) => setPlatformSettings(data.publicView))
      .catch(() => {
        /* The banner is optional; the rules it describes are not. */
      });
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    } else if (session.user.role !== role) {
      router.replace(buildDashboardRoute(session.user.role));
    }
  }, [role, router, session]);

  if (!session || session.user.role !== role) {
    return <View className="flex-1 bg-slate-50 dark:bg-canvas" />;
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-canvas">
      <MarketplaceHeader homeRoute={homeRoute} onHome={onHome} />
      <PlatformNoticeBanner settings={platformSettings} />
      {children}
    </View>
  );
}

/**
 * A small modal used where a screen needs a one-off choice. Kept here so light
 * and dark look the same everywhere.
 */
export function SheetModal({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
        className="flex-1 bg-surface/50"
      >
        <View className="mt-auto bg-surface px-4 pb-8 pt-4">
          <Text className="text-base font-bold text-primary">{title}</Text>
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

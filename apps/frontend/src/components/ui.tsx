import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export type StatusTone = 'neutral' | 'pending' | 'success' | 'error';

/**
 * Each tone pairs a container colour with a label colour.
 *
 * The label colour lives on the `Text`, not on the container. React Native Web
 * does not inherit `color` from a parent `View` into a `Text`, so a badge that
 * only set the colour on its container rendered its label in the browser's
 * default black - readable on a pale badge by accident and completely invisible
 * on the dark variants.
 */
const TONE_STYLES: Record<StatusTone, { box: string; label: string }> = {
  neutral: { box: 'bg-surface-muted', label: 'text-secondary' },
  pending: { box: 'bg-warning-soft', label: 'text-warning' },
  success: { box: 'bg-success-soft', label: 'text-success' },
  error: { box: 'bg-danger-soft', label: 'text-danger' },
};

/**
 * A status pill with a correct label colour.
 *
 * This exists because the pattern was hand-rolled in four places as
 * `<View className="bg-brand-100 text-brand-800"><Text>ACTIVE</Text></View>`.
 * React Native Web does not inherit `color` from a parent View into a Text, so
 * every one of those rendered the label in the browser's default black - fine on
 * a pale chip by luck, unreadable on the dark variant. The label colour is set
 * here, on the Text, where it actually applies.
 */
export function StatusPill({
  label,
  tone = 'neutral',
  uppercase = true,
}: {
  label: string;
  tone?: StatusTone;
  uppercase?: boolean;
}) {
  const style = TONE_STYLES[tone];
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${style.box}`}>
      <Text
        className={`text-xs font-bold ${uppercase ? 'uppercase ' : ''}${style.label}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** Small status label used across the app (API state, booking state, sync). */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  const style = TONE_STYLES[tone];
  return (
    <View className={`self-start rounded-full px-3 py-1 ${style.box}`}>
      <Text className={`text-xs font-semibold uppercase tracking-wide ${style.label}`}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The one "verified" mark used everywhere a professional is shown.
 *
 * Rendered only for a real `VERIFIED` status. An unverified professional shows
 * nothing rather than a placeholder, so the badge never implies a check that
 * has not happened.
 */
export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Identity verified"
      className="self-start flex-row items-center gap-1 rounded-full bg-success-soft px-2.5 py-1"
    >
      <Text className="text-xs">✅</Text>
      <Text className="text-xs font-semibold text-success">
        {compact ? 'Verified' : 'Identity verified'}
      </Text>
    </View>
  );
}

/** Primary call to action. Minimum 44pt tall so it stays tappable on mobile. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled }}
      disabled={disabled || busy}
      onPress={onPress}
      className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl px-5 py-3 ${
        disabled || busy ? 'bg-brand-300' : 'bg-brand-600 active:bg-brand-700'
      }`}
    >
      {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
      <Text className="text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

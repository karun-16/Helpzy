import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export type StatusTone = 'neutral' | 'pending' | 'success' | 'error';

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  pending: 'bg-amber-100 text-amber-800',
  success: 'bg-emerald-100 text-emerald-800',
  error: 'bg-rose-100 text-rose-800',
};

/** Small status label used across the app (API state, booking state, sync). */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <View className={`self-start rounded-full px-3 py-1 ${TONE_STYLES[tone]}`}>
      <Text className="text-xs font-semibold uppercase tracking-wide">{label}</Text>
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

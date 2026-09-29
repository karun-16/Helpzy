import { Pressable, Text, View } from 'react-native';

export function CustomerMarketplaceHeader({
  customerName,
  onHomePress,
  onLogout,
}: {
  customerName: string;
  onHomePress: () => void;
  onLogout: () => void;
}) {
  return (
    <View className="border-b border-slate-200 bg-white">
      <View className="mx-auto w-full max-w-6xl flex-row items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Pressable accessibilityRole="button" onPress={onHomePress}>
          <Text className="text-2xl font-black text-slate-900">HELPZY</Text>
        </Pressable>
        <View className="flex-row items-center gap-3">
          <View className="hidden max-w-48 sm:flex">
            <Text className="text-right text-sm font-semibold text-slate-800" numberOfLines={1}>
              {customerName}
            </Text>
            <Text className="text-right text-xs text-slate-500">Customer</Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
            <Text className="text-sm font-bold text-emerald-800">
              {customerName.trim().charAt(0).toUpperCase() || 'C'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log out"
            onPress={onLogout}
            className="min-h-10 justify-center rounded-lg border border-slate-200 px-3"
          >
            <Text className="text-sm font-semibold text-slate-700">Log out</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

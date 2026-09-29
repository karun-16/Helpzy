import { Pressable, Text, View } from 'react-native';
import type { CustomerProfessional } from '@helpzy/types';

import { StatusBadge } from '@/components/ui';

function verificationTone(status: CustomerProfessional['verification']) {
  if (status === 'VERIFIED') return 'success' as const;
  if (status === 'REJECTED') return 'error' as const;
  if (status === 'PENDING') return 'pending' as const;
  return 'neutral' as const;
}

export function ProfessionalCard({
  professional,
  serviceTitle,
  serviceSummary,
  onViewProfile,
}: {
  professional: CustomerProfessional;
  serviceTitle?: string;
  serviceSummary?: string | null;
  onViewProfile: () => void;
}) {
  return (
    <View className="flex-1 rounded-xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-slate-900">{professional.businessName}</Text>
          <Text className="mt-1 text-sm text-slate-600">{professional.fullName}</Text>
        </View>
        <StatusBadge
          label={professional.verification.replace('_', ' ')}
          tone={verificationTone(professional.verification)}
        />
      </View>

      {serviceTitle ? (
        <Text className="mt-4 text-base font-semibold text-slate-800">{serviceTitle}</Text>
      ) : null}
      {serviceSummary ? (
        <Text className="mt-1 text-sm leading-5 text-slate-600">{serviceSummary}</Text>
      ) : null}
      {professional.serviceArea ? (
        <Text className="mt-3 text-sm text-slate-600">
          Service area: {professional.serviceArea}
        </Text>
      ) : null}
      {professional.averageRating !== undefined && professional.ratingCount !== undefined ? (
        <Text className="mt-2 text-sm font-medium text-slate-700">
          {professional.averageRating.toFixed(1)} rating · {professional.ratingCount} reviews
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onViewProfile}
        className="mt-5 min-h-11 items-center justify-center rounded-lg border border-emerald-700 px-4"
      >
        <Text className="text-sm font-semibold text-emerald-800">View Profile</Text>
      </Pressable>
    </View>
  );
}

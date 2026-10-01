import { Pressable, Text, View } from 'react-native';
import type { CustomerProfessional } from '@helpzy/types';

import { StatusBadge, VerifiedBadge } from '@/components/ui';

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
    <View className="flex-1 rounded-xl border border-hairline bg-surface p-4 dark:border-hairline-strong">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-primary">{professional.businessName}</Text>
          <Text className="mt-1 text-sm text-secondary">{professional.fullName}</Text>
        </View>
        {/*
          A verified professional gets the real badge; anything else shows its
          actual state, so the card never implies a check that did not happen.
        */}
        {professional.verification === 'VERIFIED' ? (
          <VerifiedBadge compact />
        ) : (
          <StatusBadge
            label={professional.verification.replace('_', ' ')}
            tone={professional.verification === 'REJECTED' ? 'error' : 'pending'}
          />
        )}
      </View>

      {serviceTitle ? (
        <Text className="mt-4 text-base font-semibold text-primary">{serviceTitle}</Text>
      ) : null}
      {serviceSummary ? (
        <Text className="mt-1 text-sm leading-5 text-secondary">{serviceSummary}</Text>
      ) : null}
      {professional.serviceArea ? (
        <Text className="mt-3 text-sm text-secondary">
          Service area: {professional.serviceArea}
        </Text>
      ) : null}
      {professional.averageRating !== undefined && professional.ratingCount !== undefined ? (
        <Text className="mt-2 text-sm font-medium text-secondary dark:text-primary">
          {professional.averageRating.toFixed(1)} rating · {professional.ratingCount} reviews
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View profile for ${professional.businessName}`}
        onPress={onViewProfile}
        className="mt-5 min-h-11 items-center justify-center rounded-lg border border-brand-700 px-4"
      >
        <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
          View Profile
        </Text>
      </Pressable>
    </View>
  );
}

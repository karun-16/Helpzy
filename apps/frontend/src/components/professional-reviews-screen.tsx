import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  EmptyBlock,
  ErrorBlock,
  formatDateTime,
  LoadingBlock,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import type { ReviewDto } from '@helpzy/api-client';

/**
 * Reviews this professional has received.
 *
 * The API returns published reviews only, so this list matches the rating
 * customers actually see. A review still under moderation is not shown here
 * rather than shown as a pending state the professional cannot act on.
 */
export function ProfessionalReviewsScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    reviews: ReviewDto[];
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const current = result?.request === reload;
  const reviews = current ? result.reviews : [];
  const error = current && result.error;
  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.reviews
        .listReceived(controller.signal)
        .then((data) => setResult({ request: reload, reviews: data.reviews, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult({ request: reload, reviews: [], error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const average =
    reviews.length === 0
      ? null
      : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScreenShell>
        <SectionHeading
          title="My Reviews"
          onBack={() => router.replace('/professional')}
          action={
            <Pressable
              accessibilityRole="button"
              onPress={load}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                Refresh
              </Text>
            </Pressable>
          }
        />
        <Text className="mt-2 text-base text-secondary">
          {average === null
            ? 'No published reviews yet. Reviews appear after a customer confirms a completed booking and an administrator publishes the review.'
            : `${average.toFixed(2)} average from ${reviews.length} published review${
                reviews.length === 1 ? '' : 's'
              }.`}
        </Text>

        {result === null ? (
          <LoadingBlock label="Loading your reviews..." />
        ) : error ? (
          <ErrorBlock onRetry={load} />
        ) : reviews.length === 0 ? (
          <EmptyBlock
            title="No published reviews yet"
            detail="Only customers whose booking you completed and who then confirmed it can leave a review, and an administrator publishes it."
          />
        ) : (
          <View className="mt-5 gap-3">
            {reviews.map((review) => (
              <View
                key={review.id}
                className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="text-base font-bold text-primary">{review.serviceTitle}</Text>
                    <Text className="mt-1 text-sm text-secondary">
                      {review.customerName} · {review.bookingReference}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <View className="rounded-full bg-amber-100 px-2.5 py-1">
                      <Text className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {review.rating}/5
                      </Text>
                    </View>
                    <ReviewStatus status={review.status} />
                  </View>
                </View>
                {review.comment ? (
                  <Text className="mt-3 text-sm leading-6 text-secondary dark:text-primary">
                    {review.comment}
                  </Text>
                ) : (
                  <Text className="mt-3 text-sm italic text-muted">
                    No comment was left with this rating.
                  </Text>
                )}
                <Text className="mt-3 text-xs text-muted">{formatDateTime(review.createdAt)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScreenShell>
    </RoleScreen>
  );
}

function ReviewStatus({ status }: { status: ReviewDto['status'] }) {
  // Shared pill, so the label colour lands on the Text rather than the container.
  const tone = status === 'PUBLISHED' ? 'success' : status === 'REJECTED' ? 'error' : 'pending';
  return (
    <StatusPill
      label={
        status === 'PENDING' ? 'Under review' : status.charAt(0) + status.slice(1).toLowerCase()
      }
      tone={tone}
    />
  );
}

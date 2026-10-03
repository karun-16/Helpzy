import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { REPORT_REASONS, REPORT_TARGET_TYPES } from '@helpzy/types';

import { ActionButton, InlineError, InlineSuccess } from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';

const REASON_LABELS: Record<string, string> = {
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  FRAUD_OR_SCAM: 'Fraud or scam',
  HARASSMENT: 'Harassment or abuse',
  MISLEADING_LISTING: 'Misleading listing',
  UNSAFE_OR_UNPROFESSIONAL: 'Unsafe or unprofessional work',
  NO_SHOW: 'They did not turn up',
  PAYMENT_ISSUE: 'Payment problem',
  OTHER: 'Something else',
};

const TARGET_TYPE = REPORT_TARGET_TYPES.PROFESSIONAL;

/**
 * "Report this professional".
 *
 * Reports are deliberately a single step to start and a single step to send:
 * somebody who has just had a bad experience should not have to work through a
 * form. The description is still required, because the reason list exists for
 * triage rather than to replace an account of what happened, and a report with no
 * detail cannot be actioned.
 *
 * The person reported is told a report was filed, so there is no anonymity here
 * and the copy does not pretend otherwise.
 */
export function ReportProfessionalPanel({ professionalUserId }: { professionalUserId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS.MISLEADING_LISTING);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const descriptionValid = description.trim().length >= 10;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.reports.file({
        targetType: TARGET_TYPE,
        targetId: professionalUserId,
        reason: reason as never,
        description: description.trim(),
      });
      setDescription('');
      setOpen(false);
      setNotice('Report sent. Our team will review it.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Could not send your report. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-6">
      {!open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report this professional"
          onPress={() => {
            setOpen(true);
            setError('');
            setNotice('');
          }}
          className="self-start"
        >
          <Text className="text-sm font-semibold text-secondary">Report this professional</Text>
        </Pressable>
      ) : (
        <View className="rounded-xl border border-hairline bg-surface p-5 dark:border-hairline-strong">
          <Text className="text-base font-bold text-primary">Report a problem</Text>
          <Text className="mt-1 text-sm text-secondary">
            HELPZY reviews every report. This professional will be told a report was filed so they
            can respond.
          </Text>

          <View className="mt-4 gap-2">
            <Text className="text-sm font-semibold text-primary">What is the problem?</Text>
            {Object.entries(REASON_LABELS).map(([value, label]) => {
              const selected = value === reason;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                  onPress={() => setReason(value)}
                  className={`min-h-11 justify-center rounded-lg border px-3 ${
                    selected
                      ? 'border-action-text bg-surface-muted'
                      : 'border-hairline-strong bg-surface'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      selected ? 'font-semibold text-action-text' : 'text-secondary'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            accessibilityLabel="Describe what happened"
            value={description}
            onChangeText={setDescription}
            placeholder="Tell us what happened"
            placeholderTextColor="#94a3b8"
            multiline
            className="mt-4 min-h-24 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
          />

          <View className="mt-4 flex-row gap-3">
            <ActionButton
              label="Send report"
              onPress={submit}
              busy={busy}
              disabled={busy || !descriptionValid}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel report"
              onPress={() => setOpen(false)}
              disabled={busy}
              className="min-h-11 justify-center px-2"
            >
              <Text className="text-sm font-semibold text-secondary">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </View>
  );
}

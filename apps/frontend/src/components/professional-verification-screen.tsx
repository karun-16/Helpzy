import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {
  PROFESSIONAL_VERIFICATION_STATUSES,
  VERIFICATION_DOCUMENT_STATUSES,
  type VerificationDocumentType,
} from '@helpzy/types';
import type { VerificationStatusDto } from '@helpzy/validation';

import {
  ErrorBlock,
  formatDateTime,
  LoadingBlock,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { StatusPill, type StatusTone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const DOCUMENT_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  GST_CERTIFICATE: 'GST certificate',
  BUSINESS_LICENCE: 'Business licence',
  INSURANCE: 'Insurance',
  OTHER: 'Other document',
};

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

type AcceptedContentType = (typeof ACCEPTED_TYPES)[number];

const DOCUMENT_TONES: Record<string, StatusTone> = {
  [VERIFICATION_DOCUMENT_STATUSES.PENDING]: 'pending',
  [VERIFICATION_DOCUMENT_STATUSES.APPROVED]: 'success',
  [VERIFICATION_DOCUMENT_STATUSES.REJECTED]: 'error',
};

/**
 * A professional's verification documents.
 *
 * Uploading is deliberately *not* the same as being verified, and the copy says so
 * plainly: a professional who uploads their Aadhaar and still sees no badge will
 * otherwise assume the upload failed, resubmit it forever, and read "pending
 * review" as a rejection.
 *
 * The screen is built around what is still *outstanding* rather than around a
 * single status, because the question a professional actually has is "what is left
 * to send", and the answer changes per document type.
 */
export function ProfessionalVerificationScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    data: VerificationStatusDto | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const current = result?.request === reload;
  const status = current ? result.data : null;
  const failed = current && result.error;
  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.professionalVerification
        .status(controller.signal)
        .then((data) => setResult({ request: reload, data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult({ request: reload, data: null, error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const upload = useCallback(
    async (type: VerificationDocumentType) => {
      setBusyType(type);
      setMessage(null);
      try {
        const selection = await DocumentPicker.getDocumentAsync({
          type: [...ACCEPTED_TYPES],
          copyToCacheDirectory: true,
        });
        if (selection.canceled) return;
        const asset = selection.assets[0];
        if (!asset) return;

        /*
         * Read as base64 and posted as JSON, because that is what the endpoint
         * accepts - the same shape the profile-photo path already uses, so the app
         * needs no second upload mechanism. The filename travels as metadata only:
         * the server never builds a storage path from it.
         */
        const data = await readAsBase64(asset.uri);
        await api.professionalVerification.upload({
          type,
          contentType: asset.mimeType as AcceptedContentType,
          data,
          originalName: asset.name,
        });
        setMessage({ text: 'Submitted. An administrator will review it shortly.', failed: false });
        load();
      } catch (error) {
        setMessage({
          text: error instanceof ApiError ? error.message : 'That document could not be submitted.',
          failed: true,
        });
      } finally {
        setBusyType(null);
      }
    },
    [load],
  );

  const outstanding = new Set(status?.outstandingTypes ?? []);

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScreenShell>
        <SectionHeading
          title="Verification"
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
          Send the documents below so customers can see a verified badge. Submitting a document does
          not verify you on its own - an administrator reviews each one and then makes the
          verification decision.
        </Text>

        {result === null ? (
          <LoadingBlock label="Loading your documents..." />
        ) : failed ? (
          <ErrorBlock onRetry={load} />
        ) : !status ? null : (
          <>
            {message ? (
              <Text
                accessibilityRole={message.failed ? 'alert' : 'summary'}
                className={`mt-4 rounded-lg px-3 py-2 text-sm text-primary ${
                  message.failed ? 'bg-danger-soft' : 'bg-surface-muted'
                }`}
              >
                {message.text}
              </Text>
            ) : null}

            <View className="mt-4">
              <StatusPill
                label={status.verification.replace('_', ' ')}
                tone={
                  status.verification === PROFESSIONAL_VERIFICATION_STATUSES.VERIFIED
                    ? 'success'
                    : status.verification === PROFESSIONAL_VERIFICATION_STATUSES.REJECTED
                      ? 'error'
                      : 'pending'
                }
              />
            </View>

            <View className="mt-4 gap-3">
              {status.requiredTypes.map((type) => {
                const latest = status.documents.find((document) => document.type === type);
                return (
                  <View
                    key={type}
                    className="rounded-xl border border-hairline bg-surface p-4 dark:border-hairline-strong"
                  >
                    <View className="flex-row flex-wrap items-center justify-between gap-2">
                      <Text className="text-base font-bold text-primary">
                        {DOCUMENT_LABELS[type] ?? type}
                      </Text>
                      <StatusPill
                        label={latest ? latest.status : outstanding.has(type) ? 'Required' : 'Sent'}
                        tone={latest ? DOCUMENT_TONES[latest.status] : 'neutral'}
                      />
                    </View>
                    <Text className="mt-2 text-sm text-secondary">
                      {latest
                        ? `Submitted ${formatDateTime(latest.submittedAt)}${
                            latest.originalName ? ` · ${latest.originalName}` : ''
                          }`
                        : 'Not submitted yet.'}
                    </Text>
                    {/*
                      The rejection reason is the whole point of a rejection: without
                      it displayed, "rejected" tells the professional nothing they can
                      act on.
                    */}
                    {latest?.rejectionReason ? (
                      <Text
                        accessibilityRole="alert"
                        className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-primary"
                      >
                        Rejected: {latest.rejectionReason}
                      </Text>
                    ) : null}
                    {/*
                      The label is always rendered, spinner or not. Swapping the
                      text out for a bare spinner left a solid brand button with
                      nothing on it, which reads as a broken control rather than as
                      work in progress - and `text-inverse-text` (brand-800) on
                      `bg-brand-800` is the same colour twice over, which is why the
                      label was invisible in the first place. `text-inverse` is the
                      token for text on a dark brand panel.
                    */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Submit ${DOCUMENT_LABELS[type] ?? type}`}
                      accessibilityState={{ busy: busyType === type, disabled: busyType === type }}
                      disabled={busyType === type}
                      onPress={() => void upload(type)}
                      className="mt-3 min-h-11 flex-row items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 active:bg-brand-900 dark:bg-brand-700 dark:active:bg-brand-800"
                    >
                      {busyType === type ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : null}
                      <Text className="text-sm font-bold text-inverse">
                        {busyType === type
                          ? 'Uploading...'
                          : latest
                            ? 'Replace document'
                            : 'Submit document'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {status.documents.some((document) => !status.requiredTypes.includes(document.type)) ? (
              <Text className="mt-4 text-sm text-muted">
                Other documents you have submitted are kept on file but are not required.
              </Text>
            ) : null}
          </>
        )}
      </ScreenShell>
    </RoleScreen>
  );
}

/**
 * Reads a picked file as base64, which is what the upload endpoint expects.
 *
 * Hand-rolled rather than via `FileReader`, which is not available in every React
 * Native runtime, and rather than `btoa`, which Hermes does not provide.
 */
async function readAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  // Chunked rather than one call: `String.fromCharCode(...bytes)` overflows the
  // argument limit on a document of any real size.
  const CHUNK = 8192;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return globalThis.btoa(binary);
}

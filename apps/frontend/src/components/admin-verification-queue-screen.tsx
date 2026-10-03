import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { VERIFICATION_DOCUMENT_STATUSES, type VerificationDocumentStatus } from '@helpzy/types';
import { PROFILE_IMAGE_CONTENT_TYPES, type VerificationDocumentDto } from '@helpzy/validation';

import {
  EmptyBlock,
  ErrorBlock,
  formatDateTime,
  LoadingBlock,
  Panel,
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

const DOCUMENT_TONES: Record<VerificationDocumentStatus, StatusTone> = {
  [VERIFICATION_DOCUMENT_STATUSES.PENDING]: 'pending',
  [VERIFICATION_DOCUMENT_STATUSES.APPROVED]: 'success',
  [VERIFICATION_DOCUMENT_STATUSES.REJECTED]: 'error',
};

/**
 * The verification review queue.
 *
 * Two things are deliberately kept apart here, because conflating them is how a
 * professional ends up verified without anybody checking anything:
 *
 *  - **this screen decides a document**, not a person. Approving an Aadhaar says
 *    the document is legible and genuine; granting the verified badge is the
 *    separate verification action on the professional's record.
 *  - **the bytes are streamed, never linked**. There is no URL to paste into a
 *    chat, and the response is marked `no-store, private` so an identity document
 *    does not linger in a shared cache.
 */
export function AdminVerificationQueueScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    documents: VerificationDocumentDto[];
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);

  const current = result?.request === reload;
  const documents = current ? result.documents : [];
  const failed = current && result.error;
  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.adminVerification
        .pending(controller.signal)
        .then((data) => setResult({ request: reload, documents: data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult({ request: reload, documents: [], error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const decide = useCallback(
    async (
      documentId: string,
      decision:
        | typeof VERIFICATION_DOCUMENT_STATUSES.APPROVED
        | typeof VERIFICATION_DOCUMENT_STATUSES.REJECTED,
    ) => {
      const note = (reason[documentId] ?? '').trim();
      // Refused here as well as on the server: the server must never be the only
      // thing standing between an admin and a reasonless rejection.
      if (decision === VERIFICATION_DOCUMENT_STATUSES.REJECTED && !note) {
        setNotice({ text: 'Say why the document was rejected.', failed: true });
        return;
      }
      setBusy(documentId);
      setNotice(null);
      try {
        await api.adminVerification.review(documentId, {
          decision,
          ...(note ? { note } : {}),
        });
        setNotice({
          text:
            decision === VERIFICATION_DOCUMENT_STATUSES.APPROVED
              ? 'Document approved. Granting the verified badge is a separate action.'
              : 'Document rejected. The professional can now see the reason and resubmit.',
          failed: false,
        });
        load();
      } catch (error) {
        setNotice({
          text: error instanceof ApiError ? error.message : 'That decision could not be saved.',
          failed: true,
        });
      } finally {
        setBusy(null);
      }
    },
    [load, reason],
  );

  /*
   * A document fetched for preview, held as a blob URL.
   *
   * A blob URL rather than a data URL because these are identity documents of up
   * to 5 MB: a base64 data URL is a third larger again, several of them would
   * exhaust the browser's URL length limit, and it cannot be revoked. The bytes
   * stay in the tab's memory and go away when the preview closes.
   */
  const [preview, setPreview] = useState<{
    documentId: string;
    label: string;
    url: string;
    contentType: string;
    downloadName: string;
  } | null>(null);

  const closePreview = useCallback(() => {
    if (preview) {
      // Revoking on close is what keeps a review session from holding every
      // document the administrator opened still in memory.
      URL.revokeObjectURL(preview.url);
      setPreview(null);
    }
  }, [preview]);

  const openDocument = useCallback(async (document: VerificationDocumentDto) => {
    setNotice(null);
    setBusy(document.id);
    try {
      /*
       * Fetched rather than linked, because the endpoint requires the admin's
       * session: a plain <Image source> or a bare link would carry no bearer
       * token and simply fail. The response is the only copy of these bytes the
       * browser ever holds.
       */
      const response = await api.adminVerification.content(document.id);
      const contentType = response.headers.get('Content-Type') ?? '';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const label = DOCUMENT_LABELS[document.type] ?? document.type;
      const downloadName = downloadNameFor(document);

      if (isImage(contentType)) {
        setPreview({ documentId: document.id, label, url, contentType, downloadName });
        return;
      }

      /*
       * Anything else - a PDF, in practice - is handed to the browser's own
       * viewer. `window.open` is the only thing that gets a PDF rendered rather
       * than downloaded, and a popup blocker refusing it is a normal outcome, not
       * an error: the blob is still on disk, so the download button below works.
       */
      const opened =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.open(url, '_blank', 'noopener,noreferrer')
          : null;

      if (Platform.OS !== 'web') {
        // No file-system bridge is available on device, so a document that the
        // platform cannot render inline is reported rather than faked.
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) {
          setNotice({
            text: 'This device cannot preview that document format. Download it and open it in a viewer.',
            failed: true,
          });
        } else {
          await Linking.openURL(url);
        }
      } else if (!opened) {
        setPreview({ documentId: document.id, label, url, contentType, downloadName });
        setNotice({
          text: 'Your browser blocked the preview tab. Use “Open preview” or “Download” below.',
          failed: true,
        });
      }
    } catch (error) {
      setNotice({
        text:
          error instanceof ApiError
            ? error.message
            : 'The document could not be opened. It may no longer be available - try again shortly.',
        failed: true,
      });
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <RoleScreen role="ADMIN" homeRoute="/admin" onHome={() => router.replace('/admin')}>
      <ScreenShell>
        <SectionHeading
          title="Verification documents"
          onBack={() => router.replace('/admin')}
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
          Approving a document confirms the document itself. It does not verify the professional -
          that is a separate action on their profile.
        </Text>

        {notice ? (
          <Text
            accessibilityRole={notice.failed ? 'alert' : 'summary'}
            className={`mt-4 rounded-lg px-3 py-2 text-sm text-primary ${
              notice.failed ? 'bg-danger-soft' : 'bg-surface-muted'
            }`}
          >
            {notice.text}
          </Text>
        ) : null}

        {result === null ? (
          <LoadingBlock label="Loading the review queue..." />
        ) : failed ? (
          <ErrorBlock onRetry={load} />
        ) : documents.length === 0 ? (
          <EmptyBlock
            title="Nothing waiting for review"
            detail="Submitted documents appear here until an administrator approves or rejects them."
          />
        ) : (
          <View className="mt-5 gap-4">
            {documents.map((document) => (
              <Panel
                key={document.id}
                title={DOCUMENT_LABELS[document.type] ?? document.type}
                subtitle={`Submitted ${formatDateTime(document.submittedAt)}`}
              >
                <View className="flex-row flex-wrap items-center gap-3">
                  <StatusPill label={document.status} tone={DOCUMENT_TONES[document.status]} />
                  <Text className="text-sm text-secondary">
                    {Math.round(document.byteSize / 1024)} KB · {document.contentType}
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${DOCUMENT_LABELS[document.type] ?? document.type}`}
                  accessibilityState={{ busy: busy === document.id }}
                  onPress={() => void openDocument(document)}
                  className="mt-4 min-h-11 flex-row items-center justify-center gap-2 rounded-lg border border-hairline px-4 dark:border-hairline-strong"
                >
                  {busy === document.id ? <ActivityIndicator size="small" color="#1743b2" /> : null}
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    {busy === document.id ? 'Opening...' : 'Open document'}
                  </Text>
                </Pressable>

                {/*
                 * Always offered, not only when preview fails.
                 *
                 * The endpoint needs this administrator's bearer token, so there is
                 * no URL that could be put in an `href` - the download has to go
                 * through the same authenticated fetch. Holding the bytes already
                 * fetched means this costs nothing extra.
                 */}
                {preview?.documentId === document.id ? (
                  <View className="mt-3 flex-row flex-wrap gap-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open preview of ${DOCUMENT_LABELS[document.type] ?? document.type}`}
                      onPress={() => window.open(preview.url, '_blank', 'noopener,noreferrer')}
                      className="min-h-11 flex-row items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 dark:bg-brand-700"
                    >
                      <Text className="text-sm font-semibold text-inverse">Open preview</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Download ${DOCUMENT_LABELS[document.type] ?? document.type}`}
                      onPress={() => downloadPreview(preview.url, preview.downloadName)}
                      className="min-h-11 flex-row items-center justify-center gap-2 rounded-lg border border-hairline px-4 dark:border-hairline-strong"
                    >
                      <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                        Download
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                <View className="mt-4">
                  <Text className="text-xs font-semibold uppercase text-muted">
                    Note (required to reject)
                  </Text>
                  <TextInput
                    accessibilityLabel="Review note"
                    value={reason[document.id] ?? ''}
                    onChangeText={(next) =>
                      setReason((currentReasons) => ({ ...currentReasons, [document.id]: next }))
                    }
                    placeholder="What did you check, and what did you find?"
                    placeholderTextColor="#94a3b8"
                    multiline
                    className="mt-1 min-h-20 rounded-lg border border-hairline bg-surface px-3 py-2 text-base text-primary dark:border-hairline-strong"
                  />
                </View>

                <View className="mt-4 flex-row flex-wrap gap-3">
                  {/*
                   * `text-inverse`, not `text-inverse-text`: both are brand-800,
                   * and this button is brand-800 too, so the label was the same
                   * colour as its own background and read as an empty blue bar.
                   * Reject below is unaffected - it is dark text on a light
                   * outlined surface, which is why only the primary action
                   * looked broken.
                   */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Approve this document"
                    accessibilityState={{
                      busy: busy === document.id,
                      disabled: busy === document.id,
                    }}
                    disabled={busy === document.id}
                    onPress={() =>
                      void decide(document.id, VERIFICATION_DOCUMENT_STATUSES.APPROVED)
                    }
                    className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 active:bg-brand-900 dark:bg-brand-700"
                  >
                    {busy === document.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : null}
                    <Text className="text-sm font-bold text-inverse">
                      {busy === document.id ? 'Saving...' : 'Approve'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reject this document"
                    accessibilityState={{
                      busy: busy === document.id,
                      disabled: busy === document.id,
                    }}
                    disabled={busy === document.id}
                    onPress={() =>
                      void decide(document.id, VERIFICATION_DOCUMENT_STATUSES.REJECTED)
                    }
                    className="min-h-11 flex-1 items-center justify-center rounded-lg border border-danger/40 px-4"
                  >
                    <Text className="text-sm font-bold text-danger">Reject</Text>
                  </Pressable>
                </View>
              </Panel>
            ))}
          </View>
        )}
      </ScreenShell>

      {/*
       * In-app preview for the formats a browser renders natively.
       *
       * Kept inside the app rather than handed to `openURL`: the previous
       * approach built `data:<base64>` for images and `file:<base64>` for
       * documents, neither of which is a URL anything can display - the
       * `file:` scheme is not a data carrier at all and `data:` was missing the
       * `;base64,` separator, so every document failed the same way regardless
       * of its format. A blob URL from the authenticated response is a real URL
       * the browser knows how to render, and it never leaves the tab.
       */}
      <Modal
        visible={preview !== null && isImage(preview?.contentType ?? '')}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
      >
        <View className="flex-1 bg-black/70 p-4">
          <View className="mt-10 rounded-xl bg-surface p-4 dark:bg-slate-900">
            <Text className="text-base font-bold text-primary">{preview?.label}</Text>
            <Text className="mt-1 text-xs text-secondary">
              Previewed from this session only. Close it when you are done.
            </Text>
            {preview ? (
              <Image
                source={{ uri: preview.url }}
                accessibilityLabel={`${preview.label} document preview`}
                className="mt-3 h-72 w-full rounded-lg bg-surface-sunken"
                resizeMode="contain"
              />
            ) : null}
            <View className="mt-4 flex-row flex-wrap gap-3">
              <Pressable
                accessibilityRole="button"
                onPress={closePreview}
                className="min-h-11 flex-1 items-center justify-center rounded-lg border border-hairline px-4 dark:border-hairline-strong"
              >
                <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                  Close
                </Text>
              </Pressable>
              {preview ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${preview.label}`}
                  onPress={() => downloadPreview(preview.url, preview.downloadName)}
                  className="min-h-11 flex-1 items-center justify-center rounded-lg bg-brand-800 px-4 dark:bg-brand-700"
                >
                  <Text className="text-sm font-semibold text-inverse">Download</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </RoleScreen>
  );
}

/**
 * Whether a content type is one the browser renders as an image.
 *
 * Only the formats the upload endpoint accepts, so a preview is never attempted
 * for something `<img>` cannot show.
 */
function isImage(contentType: string): boolean {
  return PROFILE_IMAGE_CONTENT_TYPES.some((type) => contentType === type);
}

/**
 * Saves the fetched bytes under a usable filename.
 *
 * Uses a synthetic anchor rather than a navigation, because navigating to a blob
 * URL of a PDF is indistinguishable from opening it, and an administrator
 * inspecting a document needs the file on disk to be sure of what they approved.
 */
function downloadPreview(url: string, filename: string): void {
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  anchor.remove();
}

/**
 * The name to save under, from the professional's own filename when it is safe
 * to echo back and a derived one when it is not.
 *
 * The original name is attacker-controlled: it goes into a `download` attribute,
 * so a value containing a path separator must not be allowed to steer where the
 * browser writes the file.
 */
function downloadNameFor(document: VerificationDocumentDto): string {
  const original = (document.originalName ?? '').trim();
  if (original && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(original)) return original;
  const extension = document.contentType === 'application/pdf' ? 'pdf' : 'bin';
  const label = (DOCUMENT_LABELS[document.type] ?? 'document').toLowerCase().replace(/\s+/g, '-');
  return `${label}-${document.type.toLowerCase()}.${extension}`;
}

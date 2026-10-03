import {
  reviewVerificationDocumentSchema,
  uploadVerificationDocumentSchema,
  verificationDocumentSchema,
  verificationDocumentsSchema,
  verificationStatusSchema,
  type ReviewVerificationDocumentDto,
  type UploadVerificationDocumentDto,
} from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

/**
 * A professional's own verification documents.
 *
 * The professional is resolved from the session on every call, so a shared client
 * is safe without the app having to pass - or be trusted with - an identity.
 */
export function createProfessionalVerificationApi(client: HelpzyApiClient) {
  return {
    status: (signal?: AbortSignal) =>
      client.get('professional/verification-documents', {
        schema: verificationStatusSchema,
        signal,
      }),

    /**
     * Submits or replaces one document.
     *
     * This never verifies anybody: a submission only becomes a pending review,
     * and the badge is granted by the separate admin verification decision. The
     * response is the new document, so the screen can show its real status rather
     * than assuming what it became.
     */
    upload: (input: UploadVerificationDocumentDto) =>
      client.post(
        'professional/verification-documents',
        uploadVerificationDocumentSchema.parse(input),
        { schema: verificationDocumentSchema },
      ),
  };
}

export type ProfessionalVerificationApi = ReturnType<typeof createProfessionalVerificationApi>;

/**
 * The admin's review queue.
 *
 * Document bytes are fetched rather than linked: the API streams them to an
 * authenticated admin with `Cache-Control: no-store`, so there is never a URL that
 * could be pasted into a chat and opened later.
 */
export function createAdminVerificationApi(client: HelpzyApiClient) {
  return {
    pending: (signal?: AbortSignal) =>
      client.get('admin/verification-documents/pending', {
        schema: verificationDocumentsSchema,
        signal,
      }),

    document: (documentId: string, signal?: AbortSignal) =>
      client.get(`admin/verification-documents/${encodeURIComponent(documentId)}`, {
        schema: verificationDocumentSchema,
        signal,
      }),

    /**
     * Approves or rejects a submission.
     *
     * Decides the *document* only. Whether the professional is verified stays the
     * separate admin verification action, so a document can never grant a badge by
     * itself.
     */
    review: (documentId: string, input: ReviewVerificationDocumentDto) =>
      client.post(
        `admin/verification-documents/${encodeURIComponent(documentId)}/review`,
        reviewVerificationDocumentSchema.parse(input),
        { schema: verificationDocumentSchema },
      ),

    /** The document's bytes, as an authenticated response. */
    content: (documentId: string, signal?: AbortSignal) =>
      client.fetchAuthorized(
        `admin/verification-documents/${encodeURIComponent(documentId)}/content`,
        { signal },
      ),
  };
}

export type AdminVerificationApi = ReturnType<typeof createAdminVerificationApi>;

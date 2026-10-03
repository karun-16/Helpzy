import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADMIN_AUDIT_ACTIONS,
  API_ERROR_CODES,
  NOTIFICATION_TYPES,
  REQUIRED_VERIFICATION_DOCUMENT_TYPES,
  ROLES,
  VERIFICATION_DOCUMENT_STATUSES,
  type VerificationDocumentType,
} from '@helpzy/types';
import type {
  ReviewVerificationDocumentDto,
  VerificationDocumentDto,
  VerificationDocumentsDto,
  VerificationStatusDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import {
  MediaStorageService,
  decodeVerificationDocument,
  type VerificationDocumentContentType,
} from '../media/media-storage.service';
import { NotificationsService } from '../notifications/notifications.service';

const DOCUMENT_INCLUDE = {
  reviewedBy: { select: { fullName: true } },
  reviews: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      decision: true,
      note: true,
      createdAt: true,
      reviewer: { select: { fullName: true } },
    },
  },
} satisfies Prisma.VerificationDocumentInclude;

type DocumentRecord = Prisma.VerificationDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

/**
 * Professional verification documents.
 *
 * Two rules shape everything here:
 *
 *  - **Uploading never verifies.** A submission only becomes a pending review; the
 *    badge is granted solely by the separate, existing admin verification
 *    decision, so a document can never grant itself one.
 *  - **The bytes are private.** Nothing here returns a URL. An admin reads a
 *    document through {@link readDocumentForAdmin}, which resolves the bytes only
 *    after the admin guard has run, and a professional can only reach their own
 *    submissions.
 */
@Injectable()
export class VerificationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * A professional's own documents, newest first.
   *
   * Scoped through their own profile, so another professional's document is
   * simply not found.
   */
  async listForProfessional(userId: string): Promise<VerificationDocumentsDto> {
    const professionalId = await this.requireProfessionalId(userId);
    const documents = await this.prisma.verificationDocument.findMany({
      where: { professionalId },
      include: DOCUMENT_INCLUDE,
      orderBy: { submittedAt: 'desc' },
    });
    return documents.map((document) => toDto(document));
  }

  /**
   * What a professional still owes before they can be approved.
   *
   * A required type is outstanding when there is no document for it, or when the
   * most recent one was rejected - so a resubmission clears it and a refusal
   * puts it back.
   */
  async statusForProfessional(userId: string): Promise<VerificationStatusDto> {
    const professionalId = await this.requireProfessionalId(userId);
    const [profile, documents] = await Promise.all([
      this.prisma.professionalProfile.findUniqueOrThrow({
        where: { id: professionalId },
        select: { verification: true },
      }),
      this.prisma.verificationDocument.findMany({
        where: { professionalId },
        include: DOCUMENT_INCLUDE,
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    const latestByType = new Map<VerificationDocumentType, (typeof documents)[number]>();
    for (const document of documents) {
      if (!latestByType.has(document.type)) latestByType.set(document.type, document);
    }

    return {
      verification: profile.verification,
      requiredTypes: [...REQUIRED_VERIFICATION_DOCUMENT_TYPES],
      documents: documents.map((document) => toDto(document)),
      outstandingTypes: REQUIRED_VERIFICATION_DOCUMENT_TYPES.filter((type) => {
        const latest = latestByType.get(type);
        return !latest || latest.status === VERIFICATION_DOCUMENT_STATUSES.REJECTED;
      }),
    };
  }

  /**
   * Submits (or resubmits) one document.
   *
   * The declared type is checked against the bytes' own signature, so a renamed
   * file cannot smuggle in a different format. A replacement leaves the previous
   * submission in place, which is what gives an admin the history they need to
   * see how a professional's file improved.
   */
  async upload(
    userId: string,
    input: {
      type: VerificationDocumentType;
      contentType: VerificationDocumentContentType;
      data: string;
      originalName?: string;
    },
  ): Promise<VerificationDocumentDto> {
    const professionalId = await this.requireProfessionalId(userId);
    const body = decodeVerificationDocument(input.data, input.contentType);

    const stored = await this.media.storePrivateDocument({
      professionalId,
      documentType: input.type,
      contentType: input.contentType,
      body,
    });

    const document = await this.prisma.verificationDocument.create({
      data: {
        professionalId,
        type: input.type,
        // The storage key only: there is deliberately no public URL column for a
        // private document.
        storageKey: stored.storageKey,
        provider: stored.provider,
        contentType: input.contentType,
        byteSize: stored.byteSize,
        originalName: input.originalName?.slice(0, 255) ?? null,
        status: VERIFICATION_DOCUMENT_STATUSES.PENDING,
        submittedAt: new Date(),
      },
      include: DOCUMENT_INCLUDE,
    });

    return toDto(document);
  }

  /** An admin's queue: every submission still awaiting a decision. */
  async listPendingForAdmin(): Promise<VerificationDocumentsDto> {
    const documents = await this.prisma.verificationDocument.findMany({
      where: { status: VERIFICATION_DOCUMENT_STATUSES.PENDING },
      include: DOCUMENT_INCLUDE,
      orderBy: { submittedAt: 'asc' },
    });
    return documents.map((document) => toDto(document));
  }

  /** One document plus its full review history, for an admin. */
  async getForAdmin(documentId: string): Promise<VerificationDocumentDto> {
    const document = await this.prisma.verificationDocument.findUnique({
      where: { id: documentId },
      include: DOCUMENT_INCLUDE,
    });
    if (!document) throw notFound();
    return toDto(document);
  }

  /**
   * Reads a document's bytes for an admin.
   *
   * Returns the body rather than a URL, because serving these from a static path
   * would publish them. The `contentType` is the one recorded at upload, never
   * one supplied by the reader.
   */
  async readDocumentForAdmin(documentId: string): Promise<{ body: Buffer; contentType: string }> {
    const document = await this.prisma.verificationDocument.findUnique({
      where: { id: documentId },
      select: { storageKey: true, contentType: true },
    });
    if (!document) throw notFound();

    const body = await this.media.readPrivateDocument(document.storageKey);
    if (!body) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The stored document could not be found.',
      });
    }
    return { body, contentType: document.contentType };
  }

  /**
   * An admin approves or rejects a submission.
   *
   * A rejection must carry a reason - the validation schema enforces it - so a
   * professional is never refused without knowing what to fix. The decision is
   * appended to a review row as well as written on the document, so the history
   * survives a later resubmission.
   *
   * This records the *document* decision only. Whether the professional is
   * verified stays a separate, existing admin action, deliberately not granted
   * here.
   */
  async review(
    reviewerId: string,
    documentId: string,
    input: ReviewVerificationDocumentDto,
  ): Promise<VerificationDocumentDto> {
    const document = await this.prisma.verificationDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        professional: { select: { userId: true } },
      },
    });
    if (!document) throw notFound();

    if (document.status !== VERIFICATION_DOCUMENT_STATUSES.PENDING) {
      throw new BadRequestException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This document has already been reviewed.',
      });
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      // Guarded so two admins clicking at once cannot both record a decision.
      const claimed = await transaction.verificationDocument.updateMany({
        where: { id: documentId, status: VERIFICATION_DOCUMENT_STATUSES.PENDING },
        data: {
          status: input.decision,
          rejectionReason:
            input.decision === VERIFICATION_DOCUMENT_STATUSES.REJECTED
              ? (input.note ?? null)
              : null,
          reviewedAt: new Date(),
          reviewedById: reviewerId,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This document has already been reviewed.',
        });
      }

      await transaction.verificationDocumentReview.create({
        data: {
          documentId,
          reviewerId,
          decision: input.decision,
          note: input.note ?? null,
        },
      });

      return transaction.verificationDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: DOCUMENT_INCLUDE,
      });
    });

    await this.audit.record({
      actorUserId: reviewerId,
      action: ADMIN_AUDIT_ACTIONS.VERIFICATION_DOCUMENT_REVIEWED,
      entityType: 'VERIFICATION_DOCUMENT',
      entityId: documentId,
      metadata: {
        professionalId: document.professionalId,
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    const approved = input.decision === VERIFICATION_DOCUMENT_STATUSES.APPROVED;
    await this.notifications.emit([
      {
        type: NOTIFICATION_TYPES.VERIFICATION_DECISION,
        userId: document.professional.userId,
        title: approved ? 'Document accepted' : 'Document needs attention',
        body: approved
          ? 'One of your verification documents was accepted.'
          : `One of your verification documents was rejected. ${input.note ?? ''}`.trim(),
        dedupeKey: `VERIFICATION_DOCUMENT_REVIEWED:${documentId}`,
      },
    ]);

    return toDto(updated);
  }

  private async requireProfessionalId(userId: string): Promise<string> {
    const profile = await this.prisma.professionalProfile.findFirst({
      where: { userId, user: { is: { role: ROLES.PROFESSIONAL, status: 'ACTIVE' } } },
      select: { id: true },
    });
    if (!profile) throw profileNotFound();
    return profile.id;
  }
}

function toDto(document: DocumentRecord): VerificationDocumentDto {
  return {
    id: document.id,
    professionalId: document.professionalId,
    type: document.type,
    status: document.status,
    contentType: document.contentType,
    byteSize: document.byteSize,
    originalName: document.originalName,
    rejectionReason: document.rejectionReason,
    submittedAt: document.submittedAt.toISOString(),
    reviewedAt: document.reviewedAt?.toISOString() ?? null,
    reviewedByName: document.reviewedBy?.fullName ?? null,
    reviews: document.reviews.map((review) => ({
      id: review.id,
      decision: review.decision,
      note: review.note,
      reviewerName: review.reviewer.fullName,
      createdAt: review.createdAt.toISOString(),
    })),
  };
}

function notFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested document was not found.',
  });
}

function profileNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'Your professional profile could not be found.',
  });
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import {
  reviewVerificationDocumentSchema,
  uploadVerificationDocumentSchema,
} from '@helpzy/validation';
import type { Response } from 'express';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { VerificationDocumentsService } from './verification-documents.service';

/**
 * A professional's own verification documents.
 *
 * Every route resolves the professional from the session rather than from the
 * body, so one professional can never read or replace another's submission.
 */
@Controller('professional/verification-documents')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalVerificationDocumentsController {
  constructor(private readonly documents: VerificationDocumentsService) {}

  /** What is required, what has been submitted and what is still outstanding. */
  @Get()
  status(@Req() request: RequestWithUser) {
    return this.documents.statusForProfessional(request.user!.id);
  }

  /**
   * Submits or replaces a document.
   *
   * This deliberately does not verify anybody: a submission only becomes a
   * pending review, and the badge is granted by the separate admin verification
   * decision.
   */
  @Post()
  upload(@Req() request: RequestWithUser, @Body() body: unknown) {
    const parsed = uploadVerificationDocumentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.documents.upload(request.user!.id, {
      type: parsed.data.type,
      contentType: parsed.data.contentType,
      data: parsed.data.data,
      ...(parsed.data.originalName !== undefined ? { originalName: parsed.data.originalName } : {}),
    });
  }
}

/**
 * The admin's view of submitted documents.
 *
 * Document bytes are streamed rather than linked, so there is no public URL that
 * could be shared or guessed. `Cache-Control: no-store` keeps an identity document
 * out of any shared cache.
 */
@Controller('admin/verification-documents')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminVerificationDocumentsController {
  constructor(private readonly documents: VerificationDocumentsService) {}

  /** The pending review queue. */
  @Get('pending')
  pending() {
    return this.documents.listPendingForAdmin();
  }

  @Get(':documentId')
  get(@Param('documentId') documentId: string) {
    return this.documents.getForAdmin(documentId);
  }

  /**
   * Approves or rejects a submission.
   *
   * A rejection must carry a reason. Note this decides the *document* only -
   * whether the professional is verified stays the separate admin verification
   * action, so a document can never grant a badge by itself.
   */
  @Post(':documentId/review')
  review(
    @Req() request: RequestWithUser,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = reviewVerificationDocumentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.documents.review(request.user!.id, documentId, parsed.data);
  }

  /**
   * Streams a document's bytes to an authorised admin.
   *
   * The body comes from private storage, not from the public media mount, and the
   * response is marked private so it is never cached or indexed.
   */
  @Get(':documentId/content')
  async content(@Param('documentId') documentId: string, @Res() response: Response): Promise<void> {
    const { body, contentType } = await this.documents.readDocumentForAdmin(documentId);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Content-Disposition', 'inline');
    response.send(body);
  }
}

function validationFailure(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Please check the document and try again.',
    details: issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      messages: [issue.message],
    })),
  });
}

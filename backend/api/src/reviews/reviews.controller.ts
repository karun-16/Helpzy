import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES, REVIEW_STATUSES } from '@helpzy/types';
import { createReviewSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReviewsService } from './reviews.service';

@Controller('customer/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** The signed-in customer's own reviews. */
  @Get()
  listOwn(@Req() request: RequestWithUser) {
    return this.reviews.listOwn(request.user!.id);
  }

  @Post('bookings/:bookingId')
  create(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Please check the details and try again.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }
    return this.reviews.create(request.user!.id, bookingId, parsed.data);
  }
}

/** A professional reads the reviews they have received. Never their own input. */
@Controller('professional/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  listOwn(@Req() request: RequestWithUser) {
    return this.reviews.listForProfessional(request.user!.id);
  }
}

/** Moderation is admin-only and always audited inside the service. */
@Controller('admin/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Every review with any moderation status, so an admin can act on it. */
  @Get()
  listForModeration() {
    return this.reviews.listForModeration();
  }

  @Post(':reviewId/:decision')
  moderate(
    @Req() request: RequestWithUser,
    @Param('reviewId') reviewId: string,
    @Param('decision') decision: string,
  ) {
    if (decision !== 'publish' && decision !== 'reject') {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: "Choose either 'publish' or 'reject'.",
      });
    }
    return this.reviews.moderate({
      adminId: request.user!.id,
      reviewId,
      status: decision === 'publish' ? REVIEW_STATUSES.PUBLISHED : REVIEW_STATUSES.REJECTED,
    });
  }
}

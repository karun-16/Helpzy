import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  REVIEW_STATUSES,
} from '@helpzy/types';
import type { CreateReviewDto, ProfessionalReviewsDto, ReviewDto } from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

const REVIEW_SELECT = {
  id: true,
  bookingId: true,
  rating: true,
  comment: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ReviewSelect;

/**
 * Statuses in which a customer is entitled to review the work.
 *
 * A review is a statement about completed work, so it is only possible once the
 * customer has confirmed completion. It stays open through payment, because a
 * customer should not have to pay before they are allowed to say how it went.
 */
const REVIEWABLE_STATUSES: readonly string[] = [
  BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.PAYMENT_PENDING,
  BOOKING_STATUSES.PAID,
  BOOKING_STATUSES.CLOSED,
];

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a customer's review of a booking.
   *
   * The rating is stored verbatim - it is never rounded, clamped or averaged on
   * write, and the displayed average is derived from these rows rather than from
   * a column a professional could edit.
   */
  async create(customerId: string, bookingId: string, input: CreateReviewDto): Promise<ReviewDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      select: {
        id: true,
        reference: true,
        status: true,
        serviceId: true,
        service: { select: { title: true } },
        customer: { select: { fullName: true } },
        professional: { select: { userId: true } },
        review: { select: { id: true } },
      },
    });
    if (!booking) throw bookingNotFound();
    if (booking.review) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'You have already reviewed this booking.',
      });
    }
    if (!REVIEWABLE_STATUSES.includes(booking.status)) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `A booking can only be reviewed after the work is done. This one is ${booking.status}.`,
      });
    }

    // `status: PENDING` is the honest default: a review is not published until
    // it is moderated, and a professional-facing count only ever sums PUBLISHED.
    const review = await this.prisma.review.create({
      data: {
        bookingId: booking.id,
        serviceId: booking.serviceId,
        customerId,
        rating: input.rating,
        comment: input.comment ?? null,
        status: REVIEW_STATUSES.PENDING,
      },
    });

    await this.notifications.emit([
      this.notifications.professionalBookingEvent({
        type: NOTIFICATION_TYPES.REVIEW_RECEIVED,
        professionalUserId: booking.professional.userId,
        bookingId: booking.id,
        bookingReference: booking.reference,
        customerName: booking.customer.fullName,
      }),
    ]);

    return {
      id: review.id,
      bookingId: review.bookingId,
      bookingReference: booking.reference,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      customerName: booking.customer.fullName,
      serviceTitle: booking.service.title,
      createdAt: review.createdAt.toISOString(),
    };
  }

  /**
   * The signed-in customer's own reviews, newest first. Scoped to the session
   * user, so this can never return somebody else's review.
   */
  async listOwn(customerId: string): Promise<ReviewDto[]> {
    const reviews = await this.prisma.review.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { fullName: true } },
        booking: { select: { reference: true, service: { select: { title: true } } } },
      },
    });

    return reviews.map((review) => ({
      id: review.id,
      bookingId: review.bookingId,
      bookingReference: review.booking.reference,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      customerName: review.customer.fullName,
      serviceTitle: review.booking.service?.title ?? '',
      createdAt: review.createdAt.toISOString(),
    }));
  }

  /**
   * The reviews of one professional.
   *
   * Only `PUBLISHED` reviews are returned, and the customer's name is reduced
   * to a first name. A review is not a licence to publish someone's full name,
   * and an unreviewed or rejected review does not appear at all.
   */
  async listForProfessional(professionalUserId: string): Promise<ProfessionalReviewsDto> {
    const reviews = await this.prisma.review.findMany({
      where: {
        status: REVIEW_STATUSES.PUBLISHED,
        booking: { professional: { userId: professionalUserId } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        customer: { select: { fullName: true } },
        booking: { select: { reference: true, service: { select: { title: true } } } },
      },
    });

    return {
      reviews: reviews.map((review) => ({
        id: review.id,
        bookingId: review.bookingId,
        bookingReference: review.booking.reference,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        customerName: firstNameOnly(review.customer.fullName),
        serviceTitle: review.booking.service?.title ?? '',
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Every review an admin may act on, whatever its moderation status.
   *
   * Moderation needs the pending and rejected rows too: an admin has to be able
   * to see what they rejected in order to republish or leave it alone.
   */
  async listForModeration(): Promise<ProfessionalReviewsDto> {
    const reviews = await this.prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        customer: { select: { fullName: true } },
        booking: { select: { reference: true, service: { select: { title: true } } } },
      },
    });

    return {
      reviews: reviews.map((review) => ({
        id: review.id,
        bookingId: review.bookingId,
        bookingReference: review.booking.reference,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        customerName: firstNameOnly(review.customer.fullName),
        serviceTitle: review.booking.service?.title ?? '',
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  /**
   * An admin publishes or rejects a pending review.
   *
   * The decision is audited, and the average on both the professional and the
   * service is recomputed from the published rows in the same transaction - so
   * the stored average can never drift from the reviews that justify it.
   */
  async moderate(input: {
    adminId: string;
    reviewId: string;
    status: typeof REVIEW_STATUSES.PUBLISHED | typeof REVIEW_STATUSES.REJECTED;
  }): Promise<ReviewDto> {
    const review = await this.prisma.review.findUnique({
      where: { id: input.reviewId },
      select: {
        id: true,
        bookingId: true,
        serviceId: true,
        customerId: true,
        status: true,
        booking: {
          select: {
            reference: true,
            service: { select: { title: true } },
            professional: { select: { id: true } },
          },
        },
        customer: { select: { fullName: true } },
      },
    });
    if (!review) throw reviewNotFound();
    if (review.status === input.status) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `This review is already ${review.status}.`,
      });
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.review.updateMany({
        where: { id: review.id, status: { not: input.status } },
        data: {
          status: input.status,
          moderatedBy: input.adminId,
          moderatedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw reviewNotFound();

      // Recompute rather than increment: the published set is the source of
      // truth, and a moderation that later reverses must subtract correctly.
      await this.refreshAverages(transaction, review.booking.professional.id, review.serviceId);

      return transaction.review.findUniqueOrThrow({
        where: { id: review.id },
        select: REVIEW_SELECT,
      });
    });

    await this.audit.record({
      actorUserId: input.adminId,
      action: 'REVIEW_MODERATED',
      entityType: 'REVIEW',
      entityId: review.id,
      metadata: { status: input.status, bookingId: review.bookingId },
    });

    return {
      id: updated.id,
      bookingId: updated.bookingId,
      bookingReference: review.booking.reference,
      rating: updated.rating,
      comment: updated.comment,
      status: updated.status,
      customerName: review.customer.fullName,
      serviceTitle: review.booking.service?.title ?? '',
      createdAt: updated.createdAt.toISOString(),
    };
  }

  /**
   * Recomputes the denormalised average and count for one professional and one
   * service, from the published reviews only. `avg` over an empty set is `null`,
   * which is stored as 0 with a count of 0 - so "no reviews" stays visibly
   * different from "rated zero".
   */
  private async refreshAverages(
    transaction: Prisma.TransactionClient,
    professionalId: string,
    serviceId: string,
  ): Promise<void> {
    const [professional, service] = await Promise.all([
      transaction.review.aggregate({
        where: { status: REVIEW_STATUSES.PUBLISHED, booking: { professionalId } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      transaction.review.aggregate({
        where: { status: REVIEW_STATUSES.PUBLISHED, serviceId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    await transaction.professionalProfile.updateMany({
      where: { id: professionalId },
      data: {
        averageRating: professional._avg.rating ?? 0,
        ratingCount: professional._count.rating,
      },
    });
    await transaction.service.updateMany({
      where: { id: serviceId },
      data: { averageRating: service._avg.rating ?? 0, ratingCount: service._count.rating },
    });
  }
}

function firstNameOnly(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function bookingNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested booking was not found.',
  });
}

function reviewNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested review was not found.',
  });
}

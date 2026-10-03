import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_AUDIT_ACTIONS,
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_STATUSES,
} from '@helpzy/types';
import type {
  AdminBookingDetailDto,
  OverrideBookingStatusDto,
  RefundBookingDto,
} from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Administrative oversight of individual bookings.
 *
 * The normal booking rules are written around who is allowed to do what: the
 * professional advances the work, the customer confirms it, the payment record
 * drives the money. An override deliberately breaks that rule, so it is kept on
 * a separate, deliberately narrow path with two guards:
 *
 * - a **written reason** is mandatory, because an unexplained status change is
 *   indistinguishable from a bug when somebody reads the history later;
 * - the change is attributed to the admin in both `BookingStatusHistory` and the
 *   audit log, and both parties are told, because a booking that silently jumped
 *   state looks to the customer like the professional vanished.
 *
 * A refund is deliberately not a status change: it moves the payment, not the
 * booking, and the booking is only closed as a consequence.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Everything about one booking in a single payload.
   *
   * Assembled server-side rather than by the app calling five endpoints, because
   * support needs a consistent snapshot: five reads taken seconds apart can
   * disagree, and a booking that changed between them is exactly the one being
   * investigated.
   */
  async detail(bookingId: string): Promise<AdminBookingDetailDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { select: { id: true, fullName: true, phone: true } },
        professional: {
          select: {
            id: true,
            userId: true,
            businessName: true,
            user: { select: { id: true, fullName: true, phone: true } },
          },
        },
        service: { select: { id: true, title: true } },
        address: {
          select: { line1: true, line2: true, city: true, state: true, postalCode: true },
        },
        payment: {
          select: { status: true, amount: true, method: true, failureReason: true },
        },
        review: { select: { id: true, status: true, rating: true } },
        disputes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, category: true, reason: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            createdAt: true,
            sender: { select: { id: true, fullName: true } },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            isOverride: true,
            createdAt: true,
            actor: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That booking was not found.',
      });
    }

    // The dispute table holds one row per dispute, but the relation is named in
    // the plural because a booking can be disputed more than once over its life.
    const dispute = booking.disputes[0] ?? null;

    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      scheduledStart: booking.scheduledStart.toISOString(),
      scheduledEnd: booking.scheduledEnd.toISOString(),
      priceAmount: booking.priceAmount.toNumber(),
      currency: booking.currency,
      customerNote: booking.customerNote ?? null,
      cancellationNote: booking.cancellationNote ?? null,
      createdAt: booking.createdAt.toISOString(),
      completedAt: booking.completedAt?.toISOString() ?? null,
      customer: {
        id: booking.customer.id,
        fullName: booking.customer.fullName,
        phone: booking.customer.phone ?? '',
      },
      professional: {
        id: booking.professional.user.id,
        userId: booking.professional.userId,
        fullName: booking.professional.user.fullName,
        phone: booking.professional.user.phone ?? '',
        businessName: booking.professional.businessName,
      },
      service: booking.service,
      address: booking.address ?? null,
      payment: booking.payment
        ? {
            status: booking.payment.status,
            amount: booking.payment.amount.toNumber(),
            method: booking.payment.method,
            failureReason: booking.payment.failureReason ?? null,
          }
        : null,
      review: booking.review ?? null,
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            category: dispute.category,
            reason: dispute.reason,
          }
        : null,
      messages: booking.messages.map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        sender: message.sender,
      })),
      timeline: booking.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        createdAt: entry.createdAt.toISOString(),
        actor: entry.actor,
        // Recorded rather than inferred, so an administrative intervention is
        // visible in the timeline as one.
        isOverride: entry.isOverride,
      })),
    };
  }

  /**
   * Forces a booking into a status the normal flow would not allow.
   *
   * Both parties are notified, because a booking that moves without either of
   * them acting is otherwise unexplainable from their side.
   */
  async overrideStatus(actorUserId: string, bookingId: string, input: OverrideBookingStatusDto) {
    const booking = await this.requireBooking(bookingId);

    if (booking.status === input.status) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `This booking is already ${input.status}.`,
      });
    }

    // Moving a completed-and-paid booking backwards would leave a paid booking
    // that is suddenly open again, which is what a refund exists to handle.
    if (booking.status === BOOKING_STATUSES.PAID && input.status !== BOOKING_STATUSES.CLOSED) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message:
          'This booking has already been paid. Refund it instead of moving it back to an earlier status.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: input.status },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: input.status,
          actorUserId,
          isOverride: true,
        },
      });
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.BOOKING_MODIFIED,
      entityType: 'BOOKING',
      entityId: bookingId,
      metadata: {
        from: booking.status,
        to: input.status,
        reason: input.reason,
        reference: booking.reference,
      },
    });

    await this.notifyBothParties(booking, NOTIFICATION_TYPES.SYSTEM, {
      title: 'A booking was updated by HELPZY',
      body: `Booking ${booking.reference} was moved to ${input.status} by our team. Reason: ${input.reason}`,
    });

    return this.detail(bookingId);
  }

  /**
   * Refunds a paid booking.
   *
   * Only a `PAID` payment can be refunded, and only once: the second attempt is
   * refused rather than being written off, because a silently repeated refund is
   * how money leaves a business twice.
   */
  async refund(actorUserId: string, bookingId: string, input: RefundBookingDto) {
    const booking = await this.requireBooking(bookingId);

    const payment = await this.prisma.payment.findFirst({ where: { bookingId } });
    if (!payment) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'This booking has no payment to refund.',
      });
    }
    if (payment.status === PAYMENT_STATUSES.REFUNDED) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'This booking has already been refunded.',
      });
    }
    if (payment.status !== PAYMENT_STATUSES.PAID) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `A payment that is ${payment.status.toLowerCase()} cannot be refunded.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      /*
       * Claim the payment with a status guard rather than checking and then
       * writing. The check above happens outside the transaction, so two admins
       * refunding the same booking at the same moment both pass it and both write
       * - two history rows, two audit entries and two notices for one refund.
       * `count !== 1` means somebody else got there first, and the whole refund
       * rolls back rather than half-applying.
       */
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: PAYMENT_STATUSES.PAID },
        data: {
          status: PAYMENT_STATUSES.REFUNDED,
          // The provider reference is kept so finance can reconcile it later;
          // only the reason for the state is added.
          failureReason: `Refund by HELPZY: ${input.reason}`,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'That payment was already refunded a moment ago.',
        });
      }

      // A refunded booking is finished. Closing it keeps the lifecycle consistent
      // rather than leaving a closed-out booking looking live.
      //
      // This deliberately applies to a `PAID` booking too, even though PAID is
      // normally terminal: "paid" and "refunded" are contradictory, and leaving
      // the record saying the customer paid is how a bad month gets found out
      // late instead of by this endpoint. Only an already-closed booking is left
      // alone, because closing it twice says nothing.
      if (booking.status !== BOOKING_STATUSES.CLOSED) {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: BOOKING_STATUSES.CLOSED },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: BOOKING_STATUSES.CLOSED,
            actorUserId,
            // A refund is an administrative act on this booking too, so it is
            // marked as one rather than passed off as the normal lifecycle.
            isOverride: true,
          },
        });
      }
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
      entityType: 'PAYMENT',
      entityId: payment.id,
      metadata: {
        bookingId,
        reference: booking.reference,
        amount: payment.amount.toString(),
        currency: payment.currency,
        reason: input.reason,
      },
    });

    await this.notifyBothParties(booking, NOTIFICATION_TYPES.PAYMENT_REFUNDED, {
      title: 'Payment refunded',
      body: `The payment for booking ${booking.reference} has been refunded. Reason: ${input.reason}`,
    });

    return this.detail(bookingId);
  }

  private async requireBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reference: true,
        status: true,
        completedAt: true,
        customerId: true,
        professional: { select: { userId: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That booking was not found.',
      });
    }
    return booking;
  }

  /**
   * Both parties are told about an administrative change.
   *
   * The professional is addressed by their user id and the customer by theirs,
   * so neither gets a message meant for the other.
   */
  private async notifyBothParties(
    booking: {
      id: string;
      reference: string;
      customerId: string;
      professional: { userId: string };
    },
    type: (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES],
    copy: { title: string; body: string },
  ) {
    await this.notifications.emit(
      [booking.customerId, booking.professional.userId].map((userId) => ({
        userId,
        type,
        title: copy.title,
        body: copy.body,
        bookingId: booking.id,
        // One notice per party per change, so a retried request cannot spam them.
        dedupeKey: `BOOKING_ADMIN:${booking.id}:${copy.title}:${userId}`,
      })),
    );
  }
}

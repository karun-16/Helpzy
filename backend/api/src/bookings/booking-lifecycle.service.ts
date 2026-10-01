import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  type BookingStatus,
} from '@helpzy/types';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import {
  NotificationsService,
  type CustomerEventType,
} from '../notifications/notifications.service';
import {
  CUSTOMER_LIFECYCLE_ACTION,
  isCustomerOwnedTransition,
  previousBookingLifecycleStatus,
  type ProfessionalLifecycleStatus,
} from './booking-lifecycle';

/** Where a professional-observed step notifies the customer. */
const PROFESSIONAL_STEP_NOTIFICATION: Partial<Record<BookingStatus, CustomerEventType>> = {
  [BOOKING_STATUSES.ACCEPTED]: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
  [BOOKING_STATUSES.REJECTED]: NOTIFICATION_TYPES.BOOKING_REJECTED,
  [BOOKING_STATUSES.SCHEDULED]: NOTIFICATION_TYPES.BOOKING_SCHEDULED,
  [BOOKING_STATUSES.ON_THE_WAY]: NOTIFICATION_TYPES.BOOKING_ON_THE_WAY,
  [BOOKING_STATUSES.IN_PROGRESS]: NOTIFICATION_TYPES.BOOKING_IN_PROGRESS,
  [BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL]: NOTIFICATION_TYPES.BOOKING_COMPLETED,
};

/**
 * Owns every post-acceptance status change for a booking.
 *
 * Both the professional and the customer booking services delegate here so the
 * ordering rules, the ownership scoping and the mandatory status-history write
 * exist in exactly one place. Notifications are written inside the same
 * transaction as the status change, so a user can never see a booking move
 * without being told, or be told about a move that rolled back.
 */
@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Advances a booking the assigned professional may act on. */
  async applyProfessionalTransition(input: {
    bookingId: string;
    professionalId: string;
    actorUserId: string;
    nextStatus: ProfessionalLifecycleStatus;
  }): Promise<void> {
    // A professional-owned destination can only be reached from the status that
    // precedes it, which is what makes the endpoint order-safe.
    if (isCustomerOwnedTransition(input.nextStatus)) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only the customer can confirm a completed booking.',
      });
    }
    const fromStatus = this.requiredSourceStatus(input.nextStatus);

    await this.applyTransition({
      bookingId: input.bookingId,
      ownership: { professionalId: input.professionalId },
      actorUserId: input.actorUserId,
      fromStatus,
      toStatus: input.nextStatus,
    });
  }

  /**
   * Accepts or declines a booking that is still awaiting a decision.
   *
   * ACCEPTED and REJECTED both sit directly after REQUESTED, so they go through
   * the same guarded transition as every later step rather than having their own
   * write path. That is what guarantees a decision cannot be made twice.
   */
  async applyDecision(input: {
    bookingId: string;
    professionalId: string;
    actorUserId: string;
    nextStatus: typeof BOOKING_STATUSES.ACCEPTED | typeof BOOKING_STATUSES.REJECTED;
  }): Promise<void> {
    await this.applyTransition({
      bookingId: input.bookingId,
      ownership: { professionalId: input.professionalId },
      actorUserId: input.actorUserId,
      fromStatus: BOOKING_STATUSES.REQUESTED,
      toStatus: input.nextStatus,
    });
  }

  /**
   * Confirms a professional-completed booking. The only customer-owned
   * transition in the lifecycle.
   */
  async applyCustomerConfirmation(input: {
    bookingId: string;
    customerId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.applyTransition({
      bookingId: input.bookingId,
      ownership: { customerId: input.customerId },
      actorUserId: input.actorUserId,
      fromStatus: this.requiredSourceStatus(CUSTOMER_LIFECYCLE_ACTION),
      toStatus: CUSTOMER_LIFECYCLE_ACTION,
    });
  }

  /**
   * Moves a confirmed booking into payment. Called by the payment module once a
   * Payment row exists; keeping it here means the ordering rule for
   * `PAYMENT_PENDING` lives with every other transition.
   */
  async applyPaymentPending(input: {
    bookingId: string;
    customerId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.applyTransition({
      bookingId: input.bookingId,
      ownership: { customerId: input.customerId },
      actorUserId: input.actorUserId,
      fromStatus: this.requiredSourceStatus(BOOKING_STATUSES.PAYMENT_PENDING),
      toStatus: BOOKING_STATUSES.PAYMENT_PENDING,
    });
  }

  private async applyTransition(input: {
    bookingId: string;
    ownership: { professionalId: string } | { customerId: string };
    actorUserId: string;
    fromStatus: BookingStatus;
    toStatus: BookingStatus;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.booking.findFirst({
        where: { id: input.bookingId, ...input.ownership },
        select: {
          id: true,
          status: true,
          reference: true,
          customerId: true,
          professional: { select: { userId: true, user: { select: { fullName: true } } } },
          customer: { select: { fullName: true } },
        },
      });
      // A booking that is not scoped to the actor is reported as missing so the
      // endpoints never reveal another party's booking.
      if (!current) throw this.notFound();
      if (current.status !== input.fromStatus)
        throw this.invalidTransition(current.status, input.fromStatus);

      const updated = await transaction.booking.updateMany({
        where: { id: input.bookingId, ...input.ownership, status: input.fromStatus },
        data: {
          status: input.toStatus,
          ...(input.toStatus === 'COMPLETED_BY_PROFESSIONAL' ? { completedAt: new Date() } : {}),
        },
      });
      if (updated.count !== 1) throw this.invalidTransition(current.status, input.fromStatus);

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: input.bookingId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          actorUserId: input.actorUserId,
        },
      });

      await this.emitNotificationsFor(
        transaction,
        {
          ...current,
          professional: {
            userId: current.professional.userId,
            name: current.professional.user.fullName,
          },
        },
        input.toStatus,
      );
    });
  }

  private async emitNotificationsFor(
    transaction: Prisma.TransactionClient,
    booking: {
      id: string;
      reference: string;
      customerId: string;
      professional: { userId: string; name: string };
      customer: { fullName: string };
    },
    toStatus: BookingStatus,
  ): Promise<void> {
    // A professional-owned step is news for the customer.
    const customerNotification = PROFESSIONAL_STEP_NOTIFICATION[toStatus];
    if (customerNotification) {
      await this.notifications.emit(
        [
          this.notifications.customerBookingEvent({
            type: customerNotification,
            customerUserId: booking.customerId,
            bookingId: booking.id,
            bookingReference: booking.reference,
            professionalName: booking.professional.name,
          }),
        ],
        transaction,
      );
      return;
    }

    // Customer-owned steps are news for the professional. `PAYMENT_PENDING` is
    // deliberately not here: the professional sees that state on their own job
    // list, and a notification for it would only be noise.
    if (toStatus === CUSTOMER_LIFECYCLE_ACTION) {
      await this.notifications.emit(
        [
          this.notifications.professionalBookingEvent({
            type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
            professionalUserId: booking.professional.userId,
            bookingId: booking.id,
            bookingReference: booking.reference,
            customerName: booking.customer.fullName,
          }),
        ],
        transaction,
      );
    }
  }

  private async professionalName(
    transaction: Prisma.TransactionClient,
    professionalUserId: string,
  ): Promise<string> {
    const user = await transaction.user.findUnique({
      where: { id: professionalUserId },
      select: { fullName: true },
    });
    return user?.fullName ?? 'Your professional';
  }

  /** The one status a given destination may legally be reached from. */
  private requiredSourceStatus(toStatus: BookingStatus): BookingStatus {
    const fromStatus = previousBookingLifecycleStatus(toStatus);
    if (!fromStatus) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `"${toStatus}" cannot be reached from any booking status.`,
      });
    }
    return fromStatus;
  }

  private notFound() {
    return new NotFoundException({
      code: API_ERROR_CODES.NOT_FOUND,
      message: 'The requested booking was not found.',
    });
  }

  private invalidTransition(actual: BookingStatus, expected: BookingStatus) {
    return new ConflictException({
      code: API_ERROR_CODES.CONFLICT,
      message: `This booking is ${actual} and cannot move on until it is ${expected}.`,
    });
  }
}

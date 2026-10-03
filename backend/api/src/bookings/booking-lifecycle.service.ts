import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  type BookingStatus,
} from '@helpzy/types';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
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
const CUSTOMER_CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.REQUESTED,
  BOOKING_STATUSES.ACCEPTED,
  BOOKING_STATUSES.SCHEDULED,
];

/**
 * Statuses a party may confirm *from* even though they are past that party's own
 * step, provided their confirmation is not yet recorded.
 *
 * Bookings created before mutual completion existed reached
 * `COMPLETED_BY_PROFESSIONAL` and `CUSTOMER_CONFIRMED` through plain status writes
 * that recorded no evidence. Requiring the historical status strictly would leave
 * those bookings with an action the server always refuses - the professional
 * confirming an already-completed booking, the customer confirming one the
 * professional never stamped. Accepting the status *only when the caller's own
 * evidence is missing* turns confirming into a repair instead of a dead end, and
 * cannot be used to skip a real ordering rule, because a caller who has already
 * confirmed gets a no-op before this is ever consulted.
 */
const LEGACY_COMPLETION_REPAIR_STATUSES: Record<
  'CUSTOMER' | 'PROFESSIONAL',
  readonly BookingStatus[]
> = {
  CUSTOMER: [BOOKING_STATUSES.CUSTOMER_CONFIRMED],
  PROFESSIONAL: [BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL, BOOKING_STATUSES.CUSTOMER_CONFIRMED],
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
    private readonly settings: PlatformSettingsService,
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

    /*
     * "Mark completed" is the professional's half of mutual completion, so it goes
     * through the handshake rather than the plain status write. `advance` is the
     * endpoint every caller reaches that step through, and answering it with a bare
     * transition produced a booking that read `COMPLETED_BY_PROFESSIONAL` while
     * recording neither who confirmed nor when - leaving the customer's later
     * confirmation reporting that the work had never been stamped as done.
     */
    if (input.nextStatus === BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL) {
      await this.applyCompletionConfirmation({
        bookingId: input.bookingId,
        actorUserId: input.actorUserId,
        actorRole: 'PROFESSIONAL',
      });
      return;
    }

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
   *
   * Backed by the mutual-completion handshake rather than a bare status write.
   * The endpoint predates that handshake, and answering it with a bare transition
   * produced a booking that read `CUSTOMER_CONFIRMED` while recording no evidence
   * that the customer had ever confirmed anything - which made the completion
   * record permanently disagree with the status. Delegating keeps the route
   * working for existing callers and makes every caller correct.
   */
  async applyCustomerConfirmation(input: {
    bookingId: string;
    customerId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.applyCompletionConfirmation({
      bookingId: input.bookingId,
      actorUserId: input.actorUserId,
      actorRole: 'CUSTOMER',
    });
  }

  /** Customers may cancel before the professional is on the way. */
  async applyCustomerCancellation(input: {
    bookingId: string;
    customerId: string;
    actorUserId: string;
  }): Promise<void> {
    /*
     * The status rule below and the notice window are two different questions:
     * "has the job started" and "is it too late to back out". Both must hold, so
     * the window is checked against the same scheduled start this method reads,
     * before any write is attempted.
     */
    const forWindow = await this.prisma.booking.findFirst({
      where: { id: input.bookingId, customerId: input.customerId },
      select: { scheduledStart: true },
    });
    if (!forWindow) throw this.notFound();
    await this.settings.assertCancellable(forWindow.scheduledStart);

    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.booking.findFirst({
        where: { id: input.bookingId, customerId: input.customerId },
        select: {
          id: true,
          status: true,
          reference: true,
          customerId: true,
          professional: { select: { userId: true, user: { select: { fullName: true } } } },
          customer: { select: { fullName: true } },
        },
      });
      if (!current) throw this.notFound();
      const fromStatus = current.status;
      if (!CUSTOMER_CANCELLABLE_STATUSES.includes(fromStatus)) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message:
            'This booking can no longer be cancelled after the professional starts travelling.',
        });
      }

      const updated = await transaction.booking.updateMany({
        where: {
          id: input.bookingId,
          customerId: input.customerId,
          status: fromStatus,
        },
        data: { status: BOOKING_STATUSES.CANCELLED },
      });
      if (updated.count !== 1) throw this.invalidTransition(current.status, current.status);

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: input.bookingId,
          fromStatus,
          toStatus: BOOKING_STATUSES.CANCELLED,
          actorUserId: input.actorUserId,
        },
      });

      await this.notifications.emit(
        [
          this.notifications.professionalBookingEvent({
            type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
            professionalUserId: current.professional.userId,
            bookingId: current.id,
            bookingReference: current.reference,
            customerName: current.customer.fullName,
          }),
          this.notifications.customerBookingEvent({
            type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
            customerUserId: current.customerId,
            bookingId: current.id,
            bookingReference: current.reference,
            professionalName: current.professional.user.fullName,
          }),
        ],
        transaction,
      );
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

  /**
   * Closes a paid booking. The customer's explicit final step.
   *
   * A settled payment is not the same as a wrapped-up job, so the booking
   * stays `PAID` until the customer who holds it says the work is done.
   * This is the only path to `CLOSED`, and it is scoped to the customer,
   * so neither the professional nor a stranger can close a booking on the
   * customer's behalf. Closing records an outcome both parties already
   * agreed, so it carries no new notification - both were told when the
   * booking was completed.
   */
  async applyCustomerClose(input: {
    bookingId: string;
    customerId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.applyTransition({
      bookingId: input.bookingId,
      ownership: { customerId: input.customerId },
      actorUserId: input.actorUserId,
      fromStatus: this.requiredSourceStatus(BOOKING_STATUSES.CLOSED),
      toStatus: BOOKING_STATUSES.CLOSED,
    });
  }

  /**
   * Records that one party considers the work finished.
   *
   * Completion is mutual: the first confirmation only moves the booking to
   * `COMPLETED_BY_PROFESSIONAL` and asks the other party to confirm, and only the
   * second confirmation reaches `CUSTOMER_CONFIRMED`. Each side's confirmation is
   * stored with its own timestamp and user, so the booking can be settled on
   * evidence rather than on the current status alone.
   *
   * Repeating one's own confirmation is a no-op rather than an error, which keeps
   * a double tap harmless and cannot create a second history entry.
   */
  async applyCompletionConfirmation(input: {
    bookingId: string;
    actorUserId: string;
    actorRole: 'CUSTOMER' | 'PROFESSIONAL';
    note?: string;
  }): Promise<{ completed: boolean }> {
    const isCustomer = input.actorRole === 'CUSTOMER';

    const outcome = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.booking.findFirst({
        where: {
          id: input.bookingId,
          ...(isCustomer
            ? { customerId: input.actorUserId }
            : { professional: { userId: input.actorUserId } }),
        },
        select: {
          id: true,
          status: true,
          reference: true,
          customerId: true,
          completedByProfessionalId: true,
          completedByCustomerId: true,
          professional: { select: { userId: true, user: { select: { fullName: true } } } },
          customer: { select: { fullName: true } },
        },
      });
      if (!current) throw this.notFound();

      const now = new Date();
      const alreadyConfirmed = isCustomer
        ? current.completedByCustomerId === input.actorUserId
        : current.completedByProfessionalId === input.actorUserId;

      // The professional confirms from `IN_PROGRESS`; the customer confirms from
      // `COMPLETED_BY_PROFESSIONAL`. Anything else is out of order.
      const requiredFrom = isCustomer
        ? BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL
        : BOOKING_STATUSES.IN_PROGRESS;

      // A party that has already confirmed gets a no-op, whatever the booking's
      // status is now. Without this, a double tap would be reported as an
      // out-of-order transition, because the first tap has already moved the
      // status past the one this action requires.
      if (alreadyConfirmed) {
        return { completed: false, booking: current };
      }

      // A booking whose status is already past this party's step but which never
      // recorded their confirmation is a pre-mutual-completion booking. Recording
      // the evidence is allowed; skipping ahead because of it is not.
      const isLegacyRepair = LEGACY_COMPLETION_REPAIR_STATUSES[input.actorRole].includes(
        current.status,
      );
      if (current.status !== requiredFrom && !isLegacyRepair) {
        throw this.invalidTransition(current.status, requiredFrom);
      }

      const claimed = await transaction.booking.updateMany({
        where: { id: input.bookingId, status: current.status },
        data: isCustomer
          ? { completedByCustomerId: input.actorUserId, completedByCustomerAt: now }
          : {
              completedByProfessionalId: input.actorUserId,
              completedByProfessionalAt: now,
              // The professional's confirmation is the point the work is stamped
              // as done.
              completedAt: now,
            },
      });
      if (claimed.count !== 1) throw this.invalidTransition(current.status, requiredFrom);

      // Both sides must have confirmed before the booking is complete.
      const bothAgreed = isCustomer
        ? Boolean(current.completedByProfessionalId)
        : Boolean(current.completedByCustomerId);

      if (!bothAgreed) {
        /*
         * Only the professional's confirmation moves the status, and only from the
         * step that confirmation happens at. Everywhere else the status is already
         * correct and the evidence is the only thing that was missing, so the
         * history records the confirmation without pretending the booking moved.
         */
        const advances = !isCustomer && current.status === BOOKING_STATUSES.IN_PROGRESS;
        await transaction.bookingStatusHistory.create({
          data: {
            bookingId: current.id,
            fromStatus: current.status,
            toStatus: advances ? BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL : current.status,
            actorUserId: input.actorUserId,
          },
        });
        if (advances) {
          const advanced = await transaction.booking.updateMany({
            where: { id: current.id, status: BOOKING_STATUSES.IN_PROGRESS },
            data: { status: BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL },
          });
          if (advanced.count !== 1) throw this.invalidTransition(current.status, requiredFrom);
        }

        return { completed: false, booking: current };
      }

      if (current.status !== BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL) {
        /*
         * Both agree and the status is already past the professional's step, which
         * only happens when repairing a pre-mutual-completion booking. The evidence
         * is now recorded and there is nothing left to move.
         */
        await transaction.bookingStatusHistory.create({
          data: {
            bookingId: current.id,
            fromStatus: current.status,
            toStatus: current.status,
            actorUserId: input.actorUserId,
          },
        });
        return { completed: true, booking: current };
      }

      // Second confirmation: the booking is now complete.
      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: current.id,
          fromStatus: BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL,
          toStatus: BOOKING_STATUSES.CUSTOMER_CONFIRMED,
          actorUserId: input.actorUserId,
        },
      });
      const moved = await transaction.booking.updateMany({
        where: { id: current.id, status: BOOKING_STATUSES.COMPLETED_BY_PROFESSIONAL },
        data: { status: BOOKING_STATUSES.CUSTOMER_CONFIRMED },
      });
      if (moved.count !== 1) throw this.invalidTransition(current.status, requiredFrom);

      return { completed: true, booking: current };
    });

    const booking = outcome.booking;
    if (outcome.completed) {
      // Both agree the work is done, so both are told the booking is settled.
      await this.notifications.emit([
        this.notifications.customerBookingEvent({
          type: NOTIFICATION_TYPES.BOOKING_COMPLETED,
          customerUserId: booking.customerId,
          bookingId: booking.id,
          bookingReference: booking.reference,
          professionalName: booking.professional.user.fullName,
        }),
        this.notifications.professionalBookingEvent({
          type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
          professionalUserId: booking.professional.userId,
          bookingId: booking.id,
          bookingReference: booking.reference,
          customerName: booking.customer.fullName,
        }),
      ]);
    } else if (!isCustomer) {
      // The professional has finished; the customer is now expected to confirm.
      await this.notifications.emit([
        this.notifications.customerBookingEvent({
          type: NOTIFICATION_TYPES.COMPLETION_AWAITING_CUSTOMER,
          customerUserId: booking.customerId,
          bookingId: booking.id,
          bookingReference: booking.reference,
          professionalName: booking.professional.user.fullName,
        }),
      ]);
    }

    return { completed: outcome.completed };
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

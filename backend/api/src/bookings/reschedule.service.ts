import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  RESCHEDULE_STATUSES,
  RESCHEDULABLE_BOOKING_STATUSES,
  type BookingStatus,
} from '@helpzy/types';
import type { RescheduleRequestDto, RescheduleStateDto } from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const RESCHEDULE_INCLUDE = {
  requestedBy: { select: { id: true, fullName: true, role: true } },
  decidedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.RescheduleRequestInclude;

type RescheduleRecord = Prisma.RescheduleRequestGetPayload<{
  include: typeof RESCHEDULE_INCLUDE;
}>;

const bookingForReschedule = {
  id: true,
  reference: true,
  status: true,
  customerId: true,
  scheduledStart: true,
  scheduledEnd: true,
  service: { select: { durationMinutes: true } },
  professional: {
    select: { userId: true, user: { select: { id: true, fullName: true } } },
  },
  customer: { select: { id: true, fullName: true } },
} satisfies Prisma.BookingSelect;

type RescheduleBooking = Prisma.BookingGetPayload<{ select: typeof bookingForReschedule }>;

/** The extra columns the reschedule flow reads and clears. */
type RescheduleBookingRow = RescheduleBooking & {
  rescheduleRequestId: string | null;
  rescheduleReturnStatus: BookingStatus | null;
};

/** Either party to a booking. */
export interface RescheduleScope {
  userId: string;
}

/**
 * Rescheduling a booking, for both parties.
 *
 * The design keeps three things separate on purpose:
 *
 *  - the **proposal** is its own append-only row, so every attempt to move a
 *    booking - including the refused ones - stays visible to both parties and to
 *    an admin;
 *  - the **booking's own schedule only changes on acceptance**, so an unanswered
 *    proposal can never silently lose an appointment;
 *  - the **status the job returns to** is recorded when the proposal is raised,
 *    so accepting restores exactly where the job was instead of guessing.
 *
 * Every write re-checks its preconditions inside the transaction, which is what
 * stops two people acting on the same booking at the same moment from both
 * succeeding.
 */
@Injectable()
export class RescheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** The full proposal history for a booking, newest first. */
  async list(bookingId: string, scope: RescheduleScope): Promise<RescheduleRequestDto[]> {
    const booking = await this.requireScopedBooking(bookingId, scope);
    const rows = await this.prisma.rescheduleRequest.findMany({
      where: { bookingId: booking.id },
      include: RESCHEDULE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toDto(row, booking.reference));
  }

  /**
   * What the viewer can do about the live proposal.
   *
   * Resolved server-side so the app never re-derives the rule: only the party
   * who did *not* raise a proposal may decide it, and only the proposer may
   * withdraw it.
   */
  async state(bookingId: string, scope: RescheduleScope): Promise<RescheduleStateDto> {
    const booking = await this.requireScopedBooking(bookingId, scope);
    const live = booking.rescheduleRequestId
      ? await this.prisma.rescheduleRequest.findFirst({
          where: { id: booking.rescheduleRequestId, status: RESCHEDULE_STATUSES.PENDING },
          include: RESCHEDULE_INCLUDE,
        })
      : null;

    const isProposer = live ? live.requestedById === scope.userId : false;

    return {
      pending: live ? toDto(live, booking.reference) : null,
      canRequest:
        live === null && RESCHEDULABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus),
      // Only the other party decides: a proposer agreeing with themselves would
      // make the agreement meaningless.
      canDecide: live !== null && !isProposer,
      canWithdraw: live !== null && isProposer,
    };
  }

  /**
   * Raises a proposal for a new time.
   *
   * Refused when a proposal is already live: a second request loses rather than
   * replacing the first, so nobody's proposal is overwritten unseen.
   */
  async request(
    bookingId: string,
    scope: RescheduleScope,
    input: { proposedStart: Date; reason?: string },
  ): Promise<RescheduleRequestDto> {
    const booking = await this.requireScopedBooking(bookingId, scope);

    // Checked before the status: a booking sitting in `RESCHEDULE_PENDING` already
    // has a proposal out, and saying "that status cannot be rescheduled" would
    // hide the real reason.
    if (booking.rescheduleRequestId) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'There is already a reschedule request waiting to be answered.',
      });
    }
    if (!RESCHEDULABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus)) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `This booking cannot be rescheduled while it is ${booking.status}.`,
      });
    }
    // Whether rescheduling is switched on, and how far ahead a move may land, are
    // platform settings. This replaces the former hardcoded "must be in the future"
    // check, which the settings check subsumes.
    await this.settings.assertReschedulableTo(input.proposedStart);
    if (input.proposedStart.getTime() === booking.scheduledStart.getTime()) {
      throw new ConflictException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'That is already the booked time.',
      });
    }

    // The job keeps its agreed length; only its start moves.
    const proposedEnd = new Date(
      input.proposedStart.getTime() + booking.service.durationMinutes * 60_000,
    );

    const created = await this.prisma.$transaction(async (transaction) => {
      /*
       * Re-checked inside the transaction, and on *both* columns that decide
       * whether the claim is still valid. Two taps in quick succession must not
       * both observe an empty slot and both insert; and because the status was
       * read before the transaction, a booking cancelled or paid in the meantime
       * must not be resumed here - the later acceptance would then move a booking
       * that should have stayed terminal, and `rescheduleReturnStatus` would hold
       * a status the booking never actually returned to.
       */
      const claimed = await transaction.booking.updateMany({
        where: { id: booking.id, rescheduleRequestId: null, status: booking.status },
        data: { rescheduleReturnStatus: booking.status },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking changed before the request could be made. Try again.',
        });
      }

      const request = await transaction.rescheduleRequest.create({
        data: {
          bookingId: booking.id,
          requestedById: scope.userId,
          previousStart: booking.scheduledStart,
          previousEnd: booking.scheduledEnd,
          proposedStart: input.proposedStart,
          proposedEnd,
          reason: input.reason ?? null,
        },
        include: RESCHEDULE_INCLUDE,
      });

      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          rescheduleRequestId: request.id,
          status: BOOKING_STATUSES.RESCHEDULE_PENDING,
        },
      });

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BOOKING_STATUSES.RESCHEDULE_PENDING,
          actorUserId: scope.userId,
        },
      });

      await this.notifications.emit(
        [
          this.bookingEvent(
            NOTIFICATION_TYPES.BOOKING_RESCHEDULE_REQUESTED,
            booking,
            this.otherPartyId(booking, scope.userId),
            input.proposedStart,
          ),
        ],
        transaction,
      );

      return request;
    });

    return toDto(created, booking.reference);
  }

  /**
   * Accepts or rejects the live proposal.
   *
   * On acceptance the schedule is replaced in the same transaction that decides
   * the proposal, so the confirmed appointment and the decision history can never
   * disagree. Either way the booking returns to the status it held when the
   * request was raised, because `RESCHEDULE_PENDING` is a pause rather than a
   * real step in the lifecycle.
   */
  async decide(
    bookingId: string,
    scope: RescheduleScope,
    input: { decision: 'ACCEPTED' | 'REJECTED'; decisionNote?: string },
  ): Promise<RescheduleRequestDto> {
    const booking = await this.requireScopedBooking(bookingId, scope);
    const pending = await this.requireLiveProposal(booking);

    if (pending.requestedById === scope.userId) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'You cannot answer your own reschedule request.',
      });
    }

    const returnStatus = booking.rescheduleReturnStatus ?? BOOKING_STATUSES.SCHEDULED;

    const decided = await this.prisma.$transaction(async (transaction) => {
      // Guarded update: only a still-pending proposal can be decided, so a
      // duplicate tap is a conflict rather than a second history entry.
      const claimed = await transaction.rescheduleRequest.updateMany({
        where: { id: pending.id, status: RESCHEDULE_STATUSES.PENDING },
        data: {
          status: input.decision,
          decisionNote: input.decisionNote ?? null,
          decidedById: scope.userId,
          decidedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This reschedule request has already been answered.',
        });
      }

      const moved = await transaction.booking.updateMany({
        where: {
          id: booking.id,
          status: BOOKING_STATUSES.RESCHEDULE_PENDING,
          rescheduleRequestId: pending.id,
        },
        data: {
          // Only an accepted proposal moves the appointment. The unique slot
          // constraint still applies, so an agreed move cannot double-book.
          ...(input.decision === 'ACCEPTED'
            ? { scheduledStart: pending.proposedStart, scheduledEnd: pending.proposedEnd }
            : {}),
          rescheduleRequestId: null,
          rescheduleReturnStatus: null,
          status: returnStatus,
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking changed while the new time was being agreed.',
        });
      }

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: BOOKING_STATUSES.RESCHEDULE_PENDING,
          toStatus: returnStatus,
          actorUserId: scope.userId,
        },
      });

      await this.notifications.emit(
        [
          this.bookingEvent(
            input.decision === 'ACCEPTED'
              ? NOTIFICATION_TYPES.BOOKING_RESCHEDULE_ACCEPTED
              : NOTIFICATION_TYPES.BOOKING_RESCHEDULE_REJECTED,
            booking,
            pending.requestedById,
            pending.proposedStart,
          ),
        ],
        transaction,
      );

      return transaction.rescheduleRequest.findUniqueOrThrow({
        where: { id: pending.id },
        include: RESCHEDULE_INCLUDE,
      });
    });

    return toDto(decided, booking.reference);
  }

  /** Withdraws a proposal the viewer raised themselves. */
  async withdraw(bookingId: string, scope: RescheduleScope): Promise<RescheduleRequestDto> {
    const booking = await this.requireScopedBooking(bookingId, scope);
    const pending = await this.requireLiveProposal(booking);

    if (pending.requestedById !== scope.userId) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only the person who asked for a new time can withdraw the request.',
      });
    }

    const returnStatus = booking.rescheduleReturnStatus ?? BOOKING_STATUSES.SCHEDULED;

    const withdrawn = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.rescheduleRequest.updateMany({
        where: { id: pending.id, status: RESCHEDULE_STATUSES.PENDING },
        data: { status: RESCHEDULE_STATUSES.WITHDRAWN, decidedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This reschedule request has already been answered.',
        });
      }

      const restored = await transaction.booking.updateMany({
        where: { id: booking.id, rescheduleRequestId: pending.id },
        data: { rescheduleRequestId: null, rescheduleReturnStatus: null, status: returnStatus },
      });
      if (restored.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking changed while the request was being withdrawn.',
        });
      }

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: BOOKING_STATUSES.RESCHEDULE_PENDING,
          toStatus: returnStatus,
          actorUserId: scope.userId,
        },
      });

      await this.notifications.emit(
        [
          this.bookingEvent(
            NOTIFICATION_TYPES.BOOKING_RESCHEDULE_WITHDRAWN,
            booking,
            // The party who was asked to answer, not the proposer: the guard above
            // guarantees `requestedById` is the caller, so addressing them would
            // tell someone their own request was withdrawn.
            this.otherPartyId(booking, scope.userId),
            pending.proposedStart,
          ),
        ],
        transaction,
      );

      return transaction.rescheduleRequest.findUniqueOrThrow({
        where: { id: pending.id },
        include: RESCHEDULE_INCLUDE,
      });
    });

    return toDto(withdrawn, booking.reference);
  }

  /**
   * Loads the booking and proves the viewer is one of its two parties.
   *
   * A booking that is not the viewer's reports "not found" rather than "forbidden",
   * so these endpoints cannot be used to discover other people's bookings.
   */
  private async requireScopedBooking(
    bookingId: string,
    scope: RescheduleScope,
  ): Promise<RescheduleBookingRow> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [{ customerId: scope.userId }, { professional: { userId: scope.userId } }],
      },
      select: {
        ...bookingForReschedule,
        rescheduleRequestId: true,
        rescheduleReturnStatus: true,
      },
    });
    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The requested booking was not found.',
      });
    }
    return booking as RescheduleBookingRow;
  }

  private async requireLiveProposal(booking: RescheduleBookingRow): Promise<RescheduleRecord> {
    const pending = booking.rescheduleRequestId
      ? await this.prisma.rescheduleRequest.findFirst({
          where: { id: booking.rescheduleRequestId, status: RESCHEDULE_STATUSES.PENDING },
          include: RESCHEDULE_INCLUDE,
        })
      : null;

    if (!pending) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'There is no reschedule request waiting to be answered.',
      });
    }
    return pending;
  }

  private otherPartyId(booking: RescheduleBooking, viewerId: string): string {
    return booking.customerId === viewerId ? booking.professional.userId : booking.customerId;
  }

  private bookingEvent(
    type:
      | typeof NOTIFICATION_TYPES.BOOKING_RESCHEDULE_REQUESTED
      | typeof NOTIFICATION_TYPES.BOOKING_RESCHEDULE_ACCEPTED
      | typeof NOTIFICATION_TYPES.BOOKING_RESCHEDULE_REJECTED
      | typeof NOTIFICATION_TYPES.BOOKING_RESCHEDULE_WITHDRAWN,
    booking: RescheduleBooking,
    recipientUserId: string,
    proposedStart: Date,
  ) {
    const title =
      type === NOTIFICATION_TYPES.BOOKING_RESCHEDULE_REQUESTED
        ? 'Reschedule requested'
        : type === NOTIFICATION_TYPES.BOOKING_RESCHEDULE_ACCEPTED
          ? 'New time agreed'
          : type === NOTIFICATION_TYPES.BOOKING_RESCHEDULE_WITHDRAWN
            ? 'Reschedule withdrawn'
            : 'Reschedule declined';

    return {
      type,
      userId: recipientUserId,
      title,
      body: `Booking ${booking.reference} was asked to move to ${proposedStart.toISOString()}.`,
      bookingId: booking.id,
      // The recipient is part of the key so each party gets their own copy of a
      // shared event exactly once, and a later request for a different time is
      // still delivered.
      dedupeKey: `${type}:${booking.id}:${recipientUserId}:${proposedStart.toISOString()}`,
    };
  }
}

function toDto(request: RescheduleRecord, bookingReference: string): RescheduleRequestDto {
  // A reschedule proposal is only ever raised by a booking party, so an admin
  // role here would mean the data was corrupted rather than a new case.
  const requestedByRole = request.requestedBy.role === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'CUSTOMER';

  return {
    id: request.id,
    bookingId: request.bookingId,
    bookingReference,
    requestedById: request.requestedById,
    requestedByName: request.requestedBy.fullName,
    requestedByRole,
    previousStart: request.previousStart.toISOString(),
    previousEnd: request.previousEnd.toISOString(),
    proposedStart: request.proposedStart.toISOString(),
    proposedEnd: request.proposedEnd.toISOString(),
    reason: request.reason,
    status: request.status,
    decisionNote: request.decisionNote,
    decidedByName: request.decidedBy?.fullName ?? null,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}

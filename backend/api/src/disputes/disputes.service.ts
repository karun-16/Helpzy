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
  DISPUTE_EVENT_TYPES,
  DISPUTE_STATUSES,
  NOTIFICATION_TYPES,
  TERMINAL_BOOKING_STATUSES,
  TERMINAL_DISPUTE_STATUSES,
} from '@helpzy/types';
import type { OpenDisputeDto, ResolveDisputeDto } from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Disputes over a booking.
 *
 * The design commitment here is that a dispute **suspends** a booking rather than
 * rewriting it. Opening one moves the booking to `DISPUTED`, which stops the
 * normal lifecycle from advancing while the problem is looked at, and closing it
 * puts the booking back exactly where it was - recorded in
 * `bookingStatusBeforeDispute` at the moment it was suspended rather than
 * guessed at on the way out. Nothing else about the booking changes: not the
 * price, not the schedule, not the payment record.
 *
 * Every step is appended to `DisputeEvent`, so an admin resolving it later sees
 * the same history the two parties saw.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Opens a dispute against a booking.
   *
   * Either participant may open one - a customer whose work was not done, and a
   * professional who turned up to an unsafe address, both need the same
   * mechanism. Only a booking they are actually party to is accepted.
   */
  async open(actorUserId: string, bookingId: string, input: OpenDisputeDto) {
    const booking = await this.requirePartyBooking(actorUserId, bookingId);

    if ((TERMINAL_BOOKING_STATUSES as readonly string[]).includes(booking.status)) {
      // A closed, cancelled or declined booking is history, so there is nothing
      // left to suspend. `PAID` is not terminal and is deliberately disputable: the
      // money moved, and "I paid and the work was not done" is the case a dispute
      // exists for. Blocking it here is what left a customer who had already paid
      // with no recourse at all.
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'This booking is already closed, so it cannot be disputed.',
      });
    }

    if (booking.status === BOOKING_STATUSES.DISPUTED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This booking already has a dispute open.',
      });
    }

    const live = await this.prisma.dispute.findFirst({
      where: { bookingId, status: { notIn: [...TERMINAL_DISPUTE_STATUSES] } },
      select: { id: true },
    });
    if (live) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This booking already has a dispute open.',
      });
    }

    // Whoever opened it, the report is against the other participant.
    const againstId =
      booking.customerId === actorUserId ? booking.professional.userId : booking.customerId;

    const dispute = await this.prisma.$transaction(async (tx) => {
      /*
       * The booking is claimed first, before anything is written.
       *
       * Suspending the booking is the point of the dispute: the normal lifecycle
       * must not advance past a problem nobody has looked at yet. The claim is
       * guarded on the status read above, because that read happened outside this
       * transaction - without the guard a booking cancelled in the meantime is
       * resurrected into `DISPUTED`, and the restore later skips a terminal status,
       * so the booking is stranded in a state neither the customer nor the admin can
       * leave.
       *
       * Ordering matters as much as the guard. A transaction rolls back on a throw,
       * but claiming first means a lost race never writes a dispute row, a first
       * event or a history entry that then has to be rolled back. Failing before
       * the first write leaves nothing to undo.
       */
      const suspended = await tx.booking.updateMany({
        where: { id: bookingId, status: booking.status },
        data: { status: BOOKING_STATUSES.DISPUTED },
      });
      if (suspended.count !== 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking changed while the dispute was being opened. Try again.',
        });
      }

      const created = await tx.dispute.create({
        data: {
          bookingId,
          openedById: actorUserId,
          againstId,
          category: input.category,
          reason: input.reason,
          status: DISPUTE_STATUSES.OPEN,
          bookingStatusBeforeDispute: booking.status,
        },
      });

      await tx.disputeEvent.create({
        data: {
          disputeId: created.id,
          actorId: actorUserId,
          type: DISPUTE_EVENT_TYPES.OPENED,
          body: input.reason,
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: BOOKING_STATUSES.DISPUTED,
          actorUserId,
        },
      });

      return created;
    });

    await this.notifications.emit([
      {
        userId: againstId,
        type: NOTIFICATION_TYPES.DISPUTE_OPENED,
        title: 'A dispute was opened',
        body: `A dispute has been opened about booking ${booking.reference}. Add your side of the story from the booking screen.`,
        bookingId,
        dedupeKey: `DISPUTE_OPENED:${dispute.id}:${againstId}`,
      },
    ]);

    return this.detailForAdmin(dispute.id);
  }

  /** The dispute on a booking, for either party or an admin. */
  async forBooking(actor: { id: string; role: string }, bookingId: string) {
    const dispute = await this.prisma.dispute.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!dispute) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'This booking has no dispute.',
      });
    }

    // A dispute is as private as the booking it belongs to: only its two parties
    // and an admin may read it.
    if (actor.role !== 'ADMIN') {
      await this.requirePartyBooking(actor.id, bookingId);
    }

    return this.detailForAdmin(dispute.id);
  }

  /** Adds a message to a live dispute from either party. */
  async addMessage(actor: { id: string; role: string }, disputeId: string, body: string) {
    const dispute = await this.requireDispute(disputeId);

    if (actor.role !== 'ADMIN') {
      const booking = await this.prisma.booking.findUnique({
        where: { id: dispute.bookingId },
        select: {
          reference: true,
          customerId: true,
          professional: { select: { userId: true } },
        },
      });
      const isParty =
        booking !== null &&
        (booking.customerId === actor.id || booking.professional.userId === actor.id);
      if (!isParty) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'That dispute was not found.',
        });
      }
    }

    if ((TERMINAL_DISPUTE_STATUSES as readonly string[]).includes(dispute.status)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'This dispute is closed, so it cannot take new messages.',
      });
    }

    const event = await this.prisma.disputeEvent.create({
      data: { disputeId, actorId: actor.id, type: DISPUTE_EVENT_TYPES.MESSAGE, body },
    });

    // The other party hears about a new message; the author already has it.
    const recipientId = dispute.openedById === actor.id ? dispute.againstId : dispute.openedById;
    if (recipientId !== actor.id) {
      await this.notifications.emit([
        {
          userId: recipientId,
          type: NOTIFICATION_TYPES.DISPUTE_UPDATED,
          title: 'New message in your dispute',
          body: 'The other party added to the dispute. Open the booking to read and reply.',
          bookingId: dispute.bookingId,
          dedupeKey: `DISPUTE_MESSAGE:${event.id}:${recipientId}`,
        },
      ]);
    }

    return this.detailForAdmin(disputeId);
  }

  async list(options: { status?: string; search?: string } = {}) {
    const search = options.search?.trim().slice(0, 80);
    const disputes = await this.prisma.dispute.findMany({
      where: {
        ...(options.status && options.status !== 'ALL' ? { status: options.status as never } : {}),
        ...(search
          ? {
              OR: [
                { reason: { contains: search, mode: 'insensitive' as const } },
                { booking: { reference: { contains: search, mode: 'insensitive' as const } } },
                { openedBy: { fullName: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        booking: { select: { reference: true, status: true } },
        openedBy: { select: { id: true, fullName: true } },
        against: { select: { id: true, fullName: true } },
      },
    });

    return disputes.map((dispute) => ({
      id: dispute.id,
      bookingId: dispute.bookingId,
      bookingReference: dispute.booking.reference,
      category: dispute.category,
      reason: dispute.reason,
      status: dispute.status,
      resolutionNote: dispute.resolutionNote ?? null,
      createdAt: dispute.createdAt.toISOString(),
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
      openedBy: dispute.openedBy,
      against: dispute.against,
      bookingStatus: dispute.booking.status,
    }));
  }

  /** Moves a live dispute to UNDER_REVIEW without deciding it. */
  async startReview(actorUserId: string, disputeId: string) {
    const dispute = await this.requireDispute(disputeId);
    if (dispute.status === DISPUTE_STATUSES.UNDER_REVIEW) {
      return this.detailForAdmin(disputeId);
    }
    this.assertLive(dispute.status, 'reviewed');
    return this.changeStatus(actorUserId, dispute, DISPUTE_STATUSES.UNDER_REVIEW, null);
  }

  /**
   * Closes a dispute and puts the booking back where it was.
   *
   * `RESOLVED` and `REJECTED` differ only in what the platform concluded, not in
   * what happens to the booking: either way the suspension is lifted, because
   * leaving a booking stuck in `DISPUTED` after the dispute is over would strand
   * it permanently.
   */
  async resolve(actorUserId: string, disputeId: string, input: ResolveDisputeDto) {
    const dispute = await this.requireDispute(disputeId);
    this.assertLive(dispute.status, 'closed');

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: input.status,
          resolutionNote: input.resolutionNote,
          resolvedById: actorUserId,
          resolvedAt: new Date(),
        },
      });

      await tx.disputeEvent.create({
        data: {
          disputeId,
          actorId: actorUserId,
          type: DISPUTE_EVENT_TYPES.RESOLUTION,
          body: input.resolutionNote,
          fromStatus: dispute.status,
          toStatus: input.status,
        },
      });

      // Restore the booking to the status it held before it was suspended - which
      // for a paid booking is `PAID`, so it resumes exactly where it left off and
      // the customer can still close it. If it has since been closed outright,
      // leave it closed rather than reopening finished work.
      const restoreTo = dispute.bookingStatusBeforeDispute as string | null;
      if (restoreTo) {
        const current = await tx.booking.findUnique({
          where: { id: dispute.bookingId },
          select: { status: true },
        });
        if (
          current &&
          current.status === BOOKING_STATUSES.DISPUTED &&
          !(TERMINAL_BOOKING_STATUSES as readonly string[]).includes(restoreTo)
        ) {
          await tx.booking.update({
            where: { id: dispute.bookingId },
            data: { status: restoreTo as never },
          });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: dispute.bookingId,
              fromStatus: BOOKING_STATUSES.DISPUTED,
              toStatus: restoreTo as never,
              actorUserId,
            },
          });
        }
      }
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.DISPUTE_STATUS_CHANGED,
      entityType: 'DISPUTE',
      entityId: disputeId,
      metadata: {
        from: dispute.status,
        to: input.status,
        bookingId: dispute.bookingId,
        restoredBookingStatus: dispute.bookingStatusBeforeDispute,
      },
    });

    const booking = await this.prisma.booking.findUnique({
      where: { id: dispute.bookingId },
      select: { reference: true },
    });

    // Both parties hear the outcome, whoever opened it.
    await this.notifications.emit(
      [dispute.openedById, dispute.againstId].map((userId) => ({
        userId,
        type: NOTIFICATION_TYPES.DISPUTE_RESOLVED,
        title: input.status === DISPUTE_STATUSES.RESOLVED ? 'Dispute resolved' : 'Dispute closed',
        body: `The dispute about booking ${booking?.reference ?? dispute.bookingId} has been closed. ${input.resolutionNote}`,
        bookingId: dispute.bookingId,
        dedupeKey: `DISPUTE_RESOLVED:${disputeId}:${userId}`,
      })),
    );

    return this.detailForAdmin(disputeId);
  }

  private assertLive(status: string, verb: string) {
    if ((TERMINAL_DISPUTE_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `This dispute has already been ${verb}.`,
      });
    }
  }

  private async changeStatus(
    actorUserId: string,
    dispute: { id: string; bookingId: string; status: string },
    next: string,
    note: string | null,
  ) {
    await this.prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: next as never },
    });
    await this.prisma.disputeEvent.create({
      data: {
        disputeId: dispute.id,
        actorId: actorUserId,
        type: DISPUTE_EVENT_TYPES.STATUS_CHANGE,
        body: note,
        fromStatus: dispute.status as never,
        toStatus: next as never,
      },
    });
    return this.detailForAdmin(dispute.id);
  }

  private async requireDispute(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That dispute was not found.',
      });
    }
    return dispute;
  }

  /**
   * Loads a booking and proves the caller is one of its two parties.
   *
   * A booking belonging to somebody else is reported as 404 rather than 403, so
   * the endpoint cannot be used to confirm that an arbitrary booking id exists.
   */
  private async requirePartyBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reference: true,
        status: true,
        customerId: true,
        professional: { select: { userId: true } },
      },
    });

    if (!booking || (booking.customerId !== userId && booking.professional.userId !== userId)) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That booking was not found.',
      });
    }

    return booking;
  }

  /** The full dispute with its history. Also the admin read endpoint. */
  async detailForAdmin(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        booking: { select: { reference: true, status: true } },
        openedBy: { select: { id: true, fullName: true } },
        against: { select: { id: true, fullName: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true, role: true } } },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That dispute was not found.',
      });
    }

    return {
      id: dispute.id,
      bookingId: dispute.bookingId,
      bookingReference: dispute.booking.reference,
      category: dispute.category,
      reason: dispute.reason,
      status: dispute.status,
      resolutionNote: dispute.resolutionNote ?? null,
      createdAt: dispute.createdAt.toISOString(),
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
      openedBy: dispute.openedBy,
      against: dispute.against,
      bookingStatus: dispute.booking.status,
      events: dispute.events.map((event) => ({
        id: event.id,
        type: event.type,
        body: event.body,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        createdAt: event.createdAt.toISOString(),
        actor: event.actor,
      })),
    };
  }
}

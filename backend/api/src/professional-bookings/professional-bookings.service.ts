import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_JOB_STATUSES,
  API_ERROR_CODES,
  TERMINAL_BOOKING_STATUSES,
  type BookingStatus,
} from '@helpzy/types';
import {
  professionalJobsSchema,
  type BookingTimelineEntryDto,
  type CompletionStateDto,
  type ProfessionalBookingDto,
  type ProfessionalJobsDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { BookingLifecycleService } from '../bookings/booking-lifecycle.service';
import type { ProfessionalLifecycleStatus } from '../bookings/booking-lifecycle';

/**
 * Statuses where the job is finished from the professional's point of view:
 * either the customer confirmed it or it was paid and closed. They belong in the
 * completed list, not in "upcoming".
 */
const COMPLETED_JOB_STATUSES: readonly BookingStatus[] = [
  'COMPLETED_BY_PROFESSIONAL',
  'CUSTOMER_CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
  'CLOSED',
];

const professionalBookingInclude = {
  service: { select: { id: true, title: true } },
  customer: { select: { id: true, fullName: true } },
  address: {
    select: {
      label: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
    },
  },
} satisfies Prisma.BookingInclude;

type BookingRecord = Prisma.BookingGetPayload<{
  include: typeof professionalBookingInclude;
}>;

@Injectable()
export class ProfessionalBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BookingLifecycleService,
  ) {}

  async listIncoming(userId: string): Promise<ProfessionalBookingDto[]> {
    const profile = await this.professionalProfileOrNull(userId);
    if (!profile) return [];

    const bookings = await this.prisma.booking.findMany({
      where: { professionalId: profile.id, status: 'REQUESTED' },
      orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'desc' }],
      include: professionalBookingInclude,
    });
    return bookings.map((booking) => this.toDto(booking));
  }

  /**
   * "My Jobs": every booking assigned to this professional, grouped by what the
   * professional can do next rather than by raw status.
   *
   * The buckets are derived from the lifecycle constants, so a new status cannot
   * be silently dropped from the UI - it has to be placed in exactly one group.
   */
  async listMyJobs(userId: string): Promise<ProfessionalJobsDto> {
    const profile = await this.professionalProfileOrNull(userId);
    if (!profile) return emptyJobs();

    const bookings = await this.prisma.booking.findMany({
      where: { professionalId: profile.id },
      orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'desc' }],
      include: professionalBookingInclude,
    });

    const upcoming: ProfessionalBookingDto[] = [];
    const active: ProfessionalBookingDto[] = [];
    const completed: ProfessionalBookingDto[] = [];

    for (const booking of bookings) {
      const status = booking.status as BookingStatus;
      if (ACTIVE_JOB_STATUSES.includes(status)) active.push(this.toDto(booking));
      else if (COMPLETED_JOB_STATUSES.includes(status)) completed.push(this.toDto(booking));
      else if (TERMINAL_BOOKING_STATUSES.includes(status)) {
        // Cancelled and rejected work is history, not something to act on.
        continue;
      } else upcoming.push(this.toDto(booking));
    }

    return { upcoming, active, completed };
  }

  async get(userId: string, bookingId: string): Promise<ProfessionalBookingDto> {
    const profile = await this.getProfessionalProfile(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, professionalId: profile.id },
      include: professionalBookingInclude,
    });
    if (!booking) throw this.notFound();
    return this.toDto(booking);
  }

  /**
   * The recorded status transitions for a booking assigned to this professional.
   *
   * Read from `booking_status_history` only. The booking is first scoped to the
   * professional's own profile, so another professional's booking reports "not
   * found" instead of exposing its history.
   */
  async timeline(userId: string, bookingId: string): Promise<BookingTimelineEntryDto[]> {
    const profile = await this.getProfessionalProfile(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, professionalId: profile.id },
      select: { id: true },
    });
    if (!booking) throw this.notFound();

    const entries = await this.prisma.bookingStatusHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actorUserId: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorName: entry.actor.fullName,
      isOwnAction: entry.actorUserId === userId,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  /**
   * Accepts or declines a booking awaiting a decision.
   *
   * The write itself goes through the shared lifecycle service, so the ordering
   * rule, the status history and the customer notification all behave exactly as
   * they do for every later step. A second decision is rejected with a conflict
   * rather than overwriting the first.
   */
  async decide(
    userId: string,
    bookingId: string,
    nextStatus: 'ACCEPTED' | 'REJECTED',
  ): Promise<ProfessionalBookingDto> {
    const profile = await this.getProfessionalProfile(userId);

    await this.lifecycle.applyDecision({
      bookingId,
      professionalId: profile.id,
      actorUserId: userId,
      nextStatus,
    });

    return this.get(userId, bookingId);
  }

  /**
   * The professional's half of mutual completion, recording who confirmed and
   * when.
   *
   * Routed through the shared lifecycle so the ordering rule, the status history
   * and the notification behave exactly as for every other step. A repeated
   * confirmation is a no-op rather than an error.
   */
  async markCompleted(
    userId: string,
    bookingId: string,
    note?: string,
  ): Promise<CompletionStateDto> {
    const profile = await this.getProfessionalProfile(userId);
    await this.requireOwnBooking(profile.id, bookingId);

    await this.lifecycle.applyCompletionConfirmation({
      bookingId,
      actorUserId: userId,
      actorRole: 'PROFESSIONAL',
      ...(note !== undefined ? { note } : {}),
    });
    return this.completionState(userId, bookingId);
  }

  /** Who has confirmed completion, and whether it is the professional's turn. */
  async completionState(userId: string, bookingId: string): Promise<CompletionStateDto> {
    const profile = await this.getProfessionalProfile(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, professionalId: profile.id },
      select: {
        status: true,
        completedByProfessionalId: true,
        completedByProfessionalAt: true,
        completedByCustomerAt: true,
        completedByProfessional: { select: { fullName: true } },
        completedByCustomer: { select: { fullName: true } },
      },
    });
    if (!booking) throw this.notFound();

    const isComplete =
      Boolean(booking.completedByProfessionalAt) && Boolean(booking.completedByCustomerAt);

    return {
      status: booking.status,
      professionalConfirmedAt: booking.completedByProfessionalAt?.toISOString() ?? null,
      professionalConfirmedByName: booking.completedByProfessional?.fullName ?? null,
      customerConfirmedAt: booking.completedByCustomerAt?.toISOString() ?? null,
      customerConfirmedByName: booking.completedByCustomer?.fullName ?? null,
      isComplete,
      awaitingViewerConfirmation: !isComplete && booking.completedByProfessionalId !== userId,
    };
  }

  /**
   * Advances an accepted booking one step along the professional-controlled
   * lifecycle. Ownership and the allowed source status are both resolved from
   * the authenticated user, never from the request body.
   */
  async advance(
    userId: string,
    bookingId: string,
    nextStatus: ProfessionalLifecycleStatus,
  ): Promise<ProfessionalBookingDto> {
    const profile = await this.getProfessionalProfile(userId);

    await this.lifecycle.applyProfessionalTransition({
      bookingId,
      professionalId: profile.id,
      actorUserId: userId,
      nextStatus,
    });

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, professionalId: profile.id },
      include: professionalBookingInclude,
    });
    if (!booking) throw this.notFound();
    return this.toDto(booking);
  }

  /**
   * A user who has never switched to the professional role has no profile.
   * Returning `null` lets the list endpoints answer with an empty list instead
   * of a 404, while the single-booking routes still fail loudly.
   */
  private async professionalProfileOrNull(userId: string) {
    return this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  private async getProfessionalProfile(userId: string) {
    const profile = await this.professionalProfileOrNull(userId);
    if (!profile) throw this.notFound();
    return profile;
  }

  /**
   * Proves a booking belongs to this professional before it is acted on, so a
   * completion can never be recorded against somebody else's job.
   */
  private async requireOwnBooking(professionalId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, professionalId },
      select: { id: true },
    });
    if (!booking) throw this.notFound();
    return booking;
  }

  private toDto(booking: BookingRecord): ProfessionalBookingDto {
    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status as BookingStatus,
      scheduledStart: booking.scheduledStart.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      requirement: booking.customerNote,
      service: booking.service,
      customer: booking.customer,
      location: booking.address,
    };
  }

  private notFound() {
    return new NotFoundException({
      code: API_ERROR_CODES.NOT_FOUND,
      message: 'The requested booking was not found.',
    });
  }

  private alreadyDecided() {
    return new ConflictException({
      code: API_ERROR_CODES.CONFLICT,
      message: 'This booking is no longer awaiting a decision.',
    });
  }
}

function emptyJobs(): ProfessionalJobsDto {
  return { upcoming: [], active: [], completed: [] };
}

export { professionalJobsSchema };

import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_TYPES, type NotificationType } from '@helpzy/types';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export interface NotificationEvent {
  type: NotificationType;
  /** Who receives it. Resolved by the caller from the booking, never from input. */
  userId: string;
  title: string;
  body: string;
  bookingId?: string | null;
  /**
   * Distinguishes otherwise identical events for the same booking, e.g.
   * `BOOKING_ACCEPTED:<bookingId>:<recipientId>`. Omitted for one-off notices.
   */
  dedupeKey?: string;
}

/**
 * Creates the in-app notifications that real booking and payment events produce.
 *
 * Delivery is idempotent by `dedupeKey`, so retrying a transition - which the
 * booking state machine allows to fail safely - cannot create duplicates.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accepts an optional transaction so a notification is committed atomically
   * with the change that caused it. Never throws: a failed notification must not
   * roll back a customer's booking.
   */
  async emit(
    events: NotificationEvent[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    for (const event of events) {
      try {
        await client.notification.create({
          data: {
            userId: event.userId,
            type: event.type,
            title: event.title,
            body: event.body,
            bookingId: event.bookingId ?? null,
            ...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
          },
        });
      } catch (error) {
        // A unique-constraint violation simply means this exact event has
        // already been delivered, which is the outcome we wanted.
        if (isUniqueConstraintError(error)) continue;
        this.logger.error(`Could not record a ${event.type} notification: ${describe(error)}`);
      }
    }
  }

  /**
   * The booking-scoped events a professional action produces for the customer.
   * The accepted `type` is narrowed to the events that actually have customer
   * copy, so a caller cannot ask for a notification that would read as noise.
   */
  customerBookingEvent(
    input: Omit<CustomerEventInput, 'type'> & { type: CustomerEventType },
  ): NotificationEvent {
    const copy = CUSTOMER_EVENT_COPY[input.type];
    return {
      type: input.type,
      userId: input.customerUserId,
      title: copy.title,
      body: copy.body({
        bookingReference: input.bookingReference,
        actorName: input.professionalName,
      }),
      bookingId: input.bookingId,
      dedupeKey: `${input.type}:${input.bookingId}:${input.customerUserId}`,
    };
  }

  /** The booking-scoped events a customer action produces for the professional. */
  professionalBookingEvent(
    input: Omit<ProfessionalEventInput, 'type'> & { type: ProfessionalEventType },
  ): NotificationEvent {
    const copy = PROFESSIONAL_EVENT_COPY[input.type];
    return {
      type: input.type,
      userId: input.professionalUserId,
      title: copy.title,
      body: copy.body({ bookingReference: input.bookingReference, actorName: input.customerName }),
      bookingId: input.bookingId,
      dedupeKey: `${input.type}:${input.bookingId}:${input.professionalUserId}`,
    };
  }

  /** Newest first, always scoped to the given user. */
  async listForUser(userId: string, limit = 50) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type as NotificationType,
        title: item.title,
        body: item.body,
        bookingId: item.bookingId,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      unreadCount,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * Marks one notification read. The `userId` filter is what prevents one user
   * from touching another's notification: an unowned id simply matches nothing.
   */
  async markRead(userId: string, notificationId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (updated.count === 0) {
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, userId },
      });
      // Already-read is a success from the caller's point of view.
      if (exists === 0) return { updated: 0 };
    }
    return { updated: updated.count };
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}

interface EventCopy {
  title: string;
  body: (input: { bookingReference: string; actorName: string }) => string;
}

const CUSTOMER_EVENT_COPY = {
  BOOKING_REQUESTED: {
    title: 'Booking request sent',
    body: (i) => `Your request ${i.bookingReference} was sent and is awaiting a response.`,
  },
  BOOKING_ACCEPTED: {
    title: 'Booking accepted',
    body: (i) => `${i.actorName} accepted your booking ${i.bookingReference}.`,
  },
  BOOKING_REJECTED: {
    title: 'Booking declined',
    body: (i) => `${i.actorName} declined your booking ${i.bookingReference}.`,
  },
  BOOKING_SCHEDULED: {
    title: 'Visit scheduled',
    body: (i) => `${i.actorName} scheduled your booking ${i.bookingReference}.`,
  },
  BOOKING_ON_THE_WAY: {
    title: 'Professional on the way',
    body: (i) => `${i.actorName} is on the way for ${i.bookingReference}.`,
  },
  BOOKING_IN_PROGRESS: {
    title: 'Service started',
    body: (i) => `Work on ${i.bookingReference} has started.`,
  },
  BOOKING_COMPLETED: {
    title: 'Service completed',
    body: (i) =>
      `${i.actorName} marked ${i.bookingReference} complete. Confirm to finish the booking.`,
  },
  BOOKING_CONFIRMED: {
    title: 'Completion confirmed',
    body: (i) => `You confirmed ${i.bookingReference} is complete.`,
  },
  PAYMENT_PENDING: {
    title: 'Payment due',
    body: (i) => `Complete the payment for ${i.bookingReference}.`,
  },
  PAYMENT_PAID: {
    title: 'Payment received',
    body: (i) => `Payment for ${i.bookingReference} was recorded.`,
  },
  PAYMENT_FAILED: {
    title: 'Payment failed',
    body: (i) => `The payment for ${i.bookingReference} could not be completed.`,
  },
  BOOKING_CANCELLED: {
    title: 'Booking cancelled',
    body: (i) => `Booking ${i.bookingReference} was cancelled.`,
  },
  REVIEW_RECEIVED: {
    title: 'Review submitted',
    body: (i) => `You reviewed ${i.bookingReference}. Thank you.`,
  },
} satisfies Record<string, EventCopy>;

const PROFESSIONAL_EVENT_COPY = {
  BOOKING_REQUESTED: {
    title: 'New booking request',
    body: (i) => `${i.actorName} requested booking ${i.bookingReference}.`,
  },
  BOOKING_CONFIRMED: {
    title: 'Customer confirmed completion',
    body: (i) => `${i.actorName} confirmed ${i.bookingReference} is complete.`,
  },
  BOOKING_CANCELLED: {
    title: 'Booking cancelled',
    body: (i) => `Booking ${i.bookingReference} was cancelled.`,
  },
  REVIEW_RECEIVED: {
    title: 'You received a review',
    body: (i) => `${i.actorName} reviewed ${i.bookingReference}.`,
  },
  PAYMENT_PAID: {
    title: 'Payment recorded',
    body: (i) => `Payment for ${i.bookingReference} was recorded.`,
  },
} satisfies Record<string, EventCopy>;

/** Only the events that actually have copy for a given audience. */
type CustomerEventType = Extract<NotificationType, keyof typeof CUSTOMER_EVENT_COPY>;
type ProfessionalEventType = Extract<NotificationType, keyof typeof PROFESSIONAL_EVENT_COPY>;

interface CustomerEventInput {
  type: CustomerEventType;
  customerUserId: string;
  bookingId: string;
  bookingReference: string;
  professionalName: string;
}

interface ProfessionalEventInput {
  type: ProfessionalEventType;
  professionalUserId: string;
  bookingId: string;
  bookingReference: string;
  customerName: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { NOTIFICATION_TYPES };
export type { CustomerEventType, ProfessionalEventType };

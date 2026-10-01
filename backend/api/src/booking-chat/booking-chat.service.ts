import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, NOTIFICATION_TYPES, TERMINAL_BOOKING_STATUSES } from '@helpzy/types';
import type { BookingStatus } from '@helpzy/types';
import type { BookingMessagesDto, SendBookingMessageDto } from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Chat attached to exactly one booking.
 *
 * There is no conversation table on purpose: the booking *is* the conversation,
 * so chat cannot outlive or escape the job it belongs to. Only the booking's
 * customer and its assigned professional may read or post - resolved from the
 * session every time, never from the request body.
 */
@Injectable()
export class BookingChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Both sides of one booking's thread, oldest first so it reads as a
   * conversation. Posting marks the other party's messages read, which is what
   * makes the unread count mean something.
   */
  async list(userId: string, bookingId: string): Promise<BookingMessagesDto> {
    await this.assertParticipant(userId, bookingId);

    await this.prisma.bookingMessage.updateMany({
      where: { bookingId, senderUserId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });

    const messages = await this.prisma.bookingMessage.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        bookingId: true,
        senderUserId: true,
        body: true,
        readAt: true,
        createdAt: true,
        sender: { select: { fullName: true } },
      },
    });

    return messages.map((message) => ({
      id: message.id,
      bookingId: message.bookingId,
      // The client needs to know which side of the thread this is, so `isOwn` is
      // computed against the session user rather than trusting a client value.
      senderUserId: message.senderUserId,
      isOwn: message.senderUserId === userId,
      senderName: message.sender.fullName,
      body: message.body,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    }));
  }

  async send(
    userId: string,
    bookingId: string,
    input: SendBookingMessageDto,
  ): Promise<BookingMessagesDto> {
    const party = await this.assertParticipant(userId, bookingId);

    if (TERMINAL_BOOKING_STATUSES.includes(party.status as BookingStatus)) {
      // A closed or cancelled job is over; keeping the thread writable would let
      // either party keep notifying the other through a dead booking.
      throw new ForbiddenException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This booking is closed, so its chat is read-only.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.bookingMessage.create({
        data: { bookingId, senderUserId: userId, body: input.body },
      }),
      // Reading the thread marks the other side's messages as read.
      this.prisma.bookingMessage.updateMany({
        where: { bookingId, senderUserId: { not: userId }, readAt: null },
        data: { readAt: new Date() },
      }),
    ]);

    const recipientUserId =
      userId === party.customerUserId ? party.professionalUserId : party.customerUserId;

    await this.notifications.emit([
      {
        type: NOTIFICATION_TYPES.SYSTEM,
        userId: recipientUserId,
        title: 'New message',
        body: `You have a new message about booking ${party.reference}.`,
        bookingId,
        // One notification per message, so two messages are two notifications.
        dedupeKey: `MESSAGE:${bookingId}:${userId}:${Date.now()}`,
      },
    ]);

    return this.list(userId, bookingId);
  }

  /**
   * Resolves the caller against the booking and returns both party ids.
   *
   * A non-participant gets a 404, not a 403: the endpoint must not confirm that
   * a booking id exists for someone who has no business knowing about it.
   */
  private async assertParticipant(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        status: true,
        customerId: true,
        professional: { select: { userId: true } },
      },
    });
    if (!booking) throw chatNotFound();

    const isCustomer = booking.customerId === userId;
    const isProfessional = booking.professional.userId === userId;
    if (!isCustomer && !isProfessional) throw chatNotFound();

    return {
      ...booking,
      customerUserId: booking.customerId,
      professionalUserId: booking.professional.userId,
    };
  }
}

function chatNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested conversation was not found.',
  });
}

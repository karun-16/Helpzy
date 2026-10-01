import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  type BookingStatus,
} from '@helpzy/types';
import type {
  BookingPaymentDto,
  PaymentCapabilityDto,
  ProfessionalPaymentDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';
import { BookingLifecycleService } from '../bookings/booking-lifecycle.service';
import { NotificationsService } from '../notifications/notifications.service';

/** The statuses from which a payment may be started. */
const PAYABLE_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.PAYMENT_PENDING,
];

/**
 * Customer payments for a confirmed booking.
 *
 * There is no gateway integration here, and nothing pretends otherwise:
 *
 * - With no provider configured, the API reports online payment as unavailable
 *   and offers only `DIRECT`. A customer who asks for `ONLINE` is refused rather
 *   than silently downgraded to a path that never charged them.
 * - The amount always comes from the agreed service price, never from the body.
 * - A direct payment is settled by the *professional* confirming they received
 *   the money, because they are the party who actually has it. A customer cannot
 *   mark their own payment paid.
 * - `PAID` and `CLOSED` are only ever reached through the booking state machine.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
  ) {}

  /**
   * What payment options actually exist right now. A client uses this to decide
   * whether to show an online button at all, so it must never claim a provider
   * is available when none is configured.
   */
  getCapabilities(): PaymentCapabilityDto {
    return {
      onlineAvailable: Boolean(this.config.paymentOnlineProvider),
      // Direct payment is always possible: it needs no infrastructure.
      directAvailable: true,
      providerName: this.config.paymentOnlineProvider ?? null,
    };
  }

  /** The customer's own payment for a booking. */
  async getForCustomer(userId: string, bookingId: string): Promise<BookingPaymentDto> {
    return toCustomerDto(await this.findPayment({ bookingId, customerId: userId }));
  }

  /** The professional's read-only view of what the customer owes or paid. */
  async getForProfessional(userId: string, bookingId: string): Promise<ProfessionalPaymentDto> {
    return toProfessionalDto(await this.findPayment({ bookingId, professionalUserId: userId }));
  }

  /**
   * Starts a payment for a confirmed booking.
   *
   * Idempotent per booking: asking again returns the existing payment rather than
   * creating a competing one, so a double-tap cannot produce two charges.
   */
  async startPayment(input: {
    customerId: string;
    bookingId: string;
    method: 'ONLINE' | 'DIRECT';
  }): Promise<BookingPaymentDto> {
    if (input.method === PAYMENT_METHODS.ONLINE && !this.config.paymentOnlineProvider) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Online payment is not available. Choose a different method.',
      });
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: input.bookingId, customerId: input.customerId },
      select: {
        id: true,
        reference: true,
        status: true,
        service: { select: { basePrice: true, currency: true } },
        payment: { select: { id: true, status: true } },
      },
    });
    if (!booking) throw bookingNotFound();

    // An in-flight or completed payment already exists for this booking.
    if (booking.payment && booking.payment.status !== 'FAILED') {
      return this.getForCustomer(input.customerId, input.bookingId);
    }

    const status = booking.status as BookingStatus;
    if (!PAYABLE_STATUSES.includes(status)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.CONFLICT,
        message: `A booking can only be paid after it is confirmed. This one is ${status}.`,
      });
    }

    await this.prisma.$transaction(async (transaction) => {
      const payment = await transaction.payment.upsert({
        where: { bookingId: booking.id },
        update: { status: 'PENDING', method: input.method, failureReason: null },
        create: {
          bookingId: booking.id,
          // The agreed amount, taken from the service - never from the request.
          amount: booking.service.basePrice,
          currency: booking.service.currency,
          method: input.method,
          status: 'PENDING',
          provider:
            input.method === PAYMENT_METHODS.ONLINE
              ? (this.config.paymentOnlineProvider ?? null)
              : null,
        },
      });

      // Append-only attempt log, so a retry is visible rather than overwritten.
      await transaction.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: input.method,
          status: 'PENDING',
          note: input.method === PAYMENT_METHODS.DIRECT ? 'Awaiting direct payment.' : null,
        },
      });
    });

    if (status !== BOOKING_STATUSES.PAYMENT_PENDING) {
      // Goes through the shared state machine, so the ordering rule and the
      // status history are written exactly as for every other transition.
      await this.lifecycle.applyPaymentPending({
        bookingId: booking.id,
        customerId: input.customerId,
        actorUserId: input.customerId,
      });
    }

    return this.getForCustomer(input.customerId, input.bookingId);
  }

  /**
   * The assigned professional confirms they received a direct payment.
   *
   * This is still a claim, not a settlement - the money moved outside the
   * platform - so it records who confirmed it and when, and it is only reachable
   * for `DIRECT` payments. An online payment is never settled through this path;
   * only a provider callback can do that, and no such callback exists yet.
   */
  async recordDirectPayment(input: {
    professionalUserId: string;
    bookingId: string;
    note?: string;
  }): Promise<ProfessionalPaymentDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: input.bookingId, professional: { userId: input.professionalUserId } },
      select: {
        id: true,
        reference: true,
        status: true,
        customerId: true,
        customer: { select: { fullName: true } },
        payment: { select: { id: true, method: true, status: true } },
      },
    });
    if (!booking) throw bookingNotFound();

    const payment = booking.payment;
    if (!payment) {
      throw new BadRequestException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'The customer has not started a payment for this booking yet.',
      });
    }
    if (payment.method !== PAYMENT_METHODS.DIRECT) {
      throw new BadRequestException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a direct payment can be recorded this way.',
      });
    }
    if (payment.status === 'PAID') {
      // Already recorded: a second confirmation is a no-op, not an error.
      return this.getForProfessional(input.professionalUserId, input.bookingId);
    }

    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.payment.updateMany({
        where: { id: payment.id, status: { not: 'PAID' } },
        data: { status: 'PAID', paidAt: new Date(), failureReason: null },
      });
      if (claimed.count !== 1) throw paymentNotFound();

      await transaction.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: PAYMENT_METHODS.DIRECT,
          status: 'PAID',
          note: input.note ?? 'Confirmed received by the professional.',
        },
      });
      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BOOKING_STATUSES.PAID,
          actorUserId: input.professionalUserId,
        },
      });
      const moved = await transaction.booking.updateMany({
        where: { id: booking.id, status: BOOKING_STATUSES.PAYMENT_PENDING },
        data: { status: BOOKING_STATUSES.PAID },
      });
      if (moved.count !== 1) {
        throw new BadRequestException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking is no longer awaiting payment.',
        });
      }
    });

    await this.notifications.emit([
      this.notifications.customerBookingEvent({
        type: NOTIFICATION_TYPES.PAYMENT_PAID,
        customerUserId: booking.customerId,
        bookingId: booking.id,
        bookingReference: booking.reference,
        professionalName: 'Your professional',
      }),
    ]);

    return this.getForProfessional(input.professionalUserId, input.bookingId);
  }

  /**
   * Only the booking's customer and its assigned professional may see a payment.
   * Anyone else gets a 404 rather than a 403, so the endpoint cannot be used to
   * probe for the existence of other people's bookings.
   */
  private async findPayment(where: {
    bookingId: string;
    customerId?: string;
    professionalUserId?: string;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        bookingId: where.bookingId,
        ...(where.customerId ? { booking: { customerId: where.customerId } } : {}),
        ...(where.professionalUserId
          ? { booking: { professional: { userId: where.professionalUserId } } }
          : {}),
      },
      select: { ...PAYMENT_SELECT, booking: { select: { reference: true } } },
    });
    if (!payment) throw paymentNotFound();
    return payment;
  }
}

const PAYMENT_SELECT = {
  id: true,
  bookingId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  provider: true,
  failureReason: true,
  paidAt: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

type PaymentRecord = Prisma.PaymentGetPayload<{
  select: typeof PAYMENT_SELECT & { booking: { select: { reference: true } } };
}>;

function toCustomerDto(payment: PaymentRecord): BookingPaymentDto {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    bookingReference: payment.booking.reference,
    amount: payment.amount.toNumber(),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    provider: payment.provider,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

function toProfessionalDto(payment: PaymentRecord): ProfessionalPaymentDto {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    bookingReference: payment.booking.reference,
    amount: payment.amount.toNumber(),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}

function bookingNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested booking was not found.',
  });
}

function paymentNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'No payment has been started for this booking.',
  });
}

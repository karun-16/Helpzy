import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  isCashFullyConfirmed,
  PAYMENT_STATUSES,
  type BookingStatus,
  type GatewayMethod,
  type PaymentMethod,
  type PaymentStatus,
} from '@helpzy/types';
import type {
  BookingPaymentDto,
  CashConfirmationDto,
  GatewayCheckoutDto,
  PaymentCapabilityDto,
  PaymentHistoryDto,
  ProfessionalPaymentDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';
import { BookingLifecycleService } from '../bookings/booking-lifecycle.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SandboxPaymentGateway, type PaymentGateway } from './payment-gateway.service';

/** Prisma's unique-constraint violation, used for webhook idempotency. */
function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** The statuses from which a payment may be started. */
const PAYABLE_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUSES.CUSTOMER_CONFIRMED,
  BOOKING_STATUSES.PAYMENT_PENDING,
];

/**
 * The only payment states a party or a gateway callback may still move.
 *
 * `PENDING` and `PROCESSING` are the two in-flight states: a charge that has
 * been asked for and not yet settled. Every other state has already reached an
 * outcome - settled, failed, returned to the customer, or held while a dispute
 * is looked at - and an outcome is not reversible by whoever asks next.
 *
 * A payment re-enters this list only by a fresh attempt: `startPayment` and
 * `startGatewayCheckout` both rewrite a `FAILED` payment back to `PENDING` or
 * `PROCESSING` for a new charge, so a genuinely retryable payment is never
 * stranded by the guard.
 */
const IN_FLIGHT_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PAYMENT_STATUSES.PENDING,
  PAYMENT_STATUSES.PROCESSING,
];

/** The Prisma filter that claims a payment only while it is still in flight. */
function claimableByInFlightPayment() {
  return { status: { in: [...IN_FLIGHT_PAYMENT_STATUSES] } };
}

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
    @Inject(SandboxPaymentGateway) private readonly gateway: PaymentGateway,
    private readonly settings: PlatformSettingsService,
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
      // Cash also needs no infrastructure, so it is never gated.
      cashAvailable: true,
      providerName: this.config.paymentOnlineProvider ?? null,
    };
  }

  /** The customer's own payment for a booking. */
  async getForCustomer(userId: string, bookingId: string): Promise<BookingPaymentDto> {
    return toCustomerDto(await this.findPayment({ bookingId, customerId: userId }), userId);
  }

  /** The professional's read-only view of what the customer owes or paid. */
  async getForProfessional(userId: string, bookingId: string): Promise<ProfessionalPaymentDto> {
    return toProfessionalDto(
      await this.findPayment({ bookingId, professionalUserId: userId }),
      userId,
    );
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
    method: PaymentMethod;
  }): Promise<BookingPaymentDto> {
    // Starting a payment is a money-moving action, so maintenance mode can block
    // it. Confirmations of payments already in flight are deliberately not
    // blocked: a professional holding cash must still be able to record it.
    await this.settings.assertNotBlocked('START_PAYMENT');

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
        // The price agreed when the booking was made, not today's service price.
        priceAmount: true,
        currency: true,
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
          /*
           * The amount snapshotted on the booking when it was created, never from
           * the request and never from the service's current price. A professional
           * can raise a listing's price at any time; a customer is charged what
           * they agreed to, and reading the live price here would quietly change
           * the amount after the fact.
           */
          amount: booking.priceAmount,
          currency: booking.currency,
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
   * Records one party's confirmation that cash changed hands.
   *
   * A single confirmation is deliberately not enough: the payment is only marked
   * `PAID` once both the customer and the professional have agreed, so one party
   * pressing the button can never mark cash as received on its own. Repeating a
   * confirmation is a no-op rather than an error, which keeps a double tap
   * harmless.
   */
  async confirmCashPayment(input: {
    actorUserId: string;
    actorRole: 'CUSTOMER' | 'PROFESSIONAL';
    bookingId: string;
    note?: string;
  }): Promise<BookingPaymentDto> {
    const booking = await this.prisma.booking.findFirst({
      where:
        input.actorRole === 'CUSTOMER'
          ? { id: input.bookingId, customerId: input.actorUserId }
          : { id: input.bookingId, professional: { userId: input.actorUserId } },
      select: {
        id: true,
        reference: true,
        status: true,
        customerId: true,
        customer: { select: { fullName: true } },
        professional: { select: { userId: true, user: { select: { fullName: true } } } },
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
    if (payment.method !== PAYMENT_METHODS.CASH) {
      throw new BadRequestException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a cash payment can be confirmed this way.',
      });
    }
    if (payment.status === 'PAID') {
      return this.getForCustomer(booking.customerId, input.bookingId);
    }

    const isCustomer = input.actorRole === 'CUSTOMER';
    const otherPartyId = isCustomer ? booking.professional.userId : booking.customerId;
    const otherPartyName = isCustomer
      ? booking.professional.user.fullName
      : booking.customer.fullName;

    const settled = await this.prisma.$transaction(async (transaction) => {
      // Only this party's own column is written, and only while it is still
      // empty, so a repeated confirmation cannot overwrite an earlier one.
      const claimed = await transaction.payment.updateMany({
        where: {
          id: payment.id,
          ...(isCustomer
            ? { cashConfirmedByCustomerId: null }
            : { cashConfirmedByProfessionalId: null }),
        },
        data: isCustomer
          ? { cashConfirmedByCustomerId: input.actorUserId, cashConfirmedByCustomerAt: new Date() }
          : {
              cashConfirmedByProfessionalId: input.actorUserId,
              cashConfirmedByProfessionalAt: new Date(),
            },
      });

      // This party had already confirmed: nothing to do.
      if (claimed.count === 0) return false;
      // Re-read inside the transaction: whether to settle is decided from both
      // timestamps, never from "this happened to be the second tap".
      const current = await transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: {
          cashConfirmedByCustomerAt: true,
          cashConfirmedByProfessionalAt: true,
        },
      });

      if (
        !isCashFullyConfirmed({
          customerConfirmedAt: current.cashConfirmedByCustomerAt,
          professionalConfirmedAt: current.cashConfirmedByProfessionalAt,
        })
      ) {
        await transaction.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            method: PAYMENT_METHODS.CASH,
            status: PAYMENT_STATUSES.PENDING,
            note:
              input.note ??
              `${isCustomer ? 'Customer' : 'Professional'} confirmed the cash handover.`,
          },
        });
        return false;
      }

      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: PAYMENT_STATUSES.PAID,
          paidAt: new Date(),
          failureReason: null,
          // Cash is settled by agreement, not by a provider, so it is explicitly
          // *not* a gateway-verified transaction.
          gatewayVerified: false,
        },
      });

      await transaction.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: PAYMENT_METHODS.CASH,
          status: PAYMENT_STATUSES.PAID,
          note: 'Both parties confirmed the cash handover.',
        },
      });

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BOOKING_STATUSES.PAID,
          actorUserId: input.actorUserId,
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

      return true;
    });

    if (settled) {
      await this.notifications.emit([
        this.notifications.customerBookingEvent({
          type: NOTIFICATION_TYPES.PAYMENT_PAID,
          customerUserId: booking.customerId,
          bookingId: booking.id,
          bookingReference: booking.reference,
          professionalName: otherPartyName,
        }),
      ]);
    } else {
      // One-sided confirmation: tell the other party they are still expected.
      await this.notifications.emit([
        {
          type: NOTIFICATION_TYPES.PAYMENT_AWAITING_BOTH,
          userId: otherPartyId,
          title: 'Confirm the cash payment',
          body: `Booking ${booking.reference} is waiting for you to confirm the cash handover.`,
          bookingId: booking.id,
          dedupeKey: `PAYMENT_AWAITING_BOTH:${payment.id}:${otherPartyId}`,
        },
      ]);
    }

    return this.getForCustomer(booking.customerId, input.bookingId);
  }

  /**
   * Opens a gateway checkout for a booking.
   *
   * This is the only online path, and it deliberately does **not** settle
   * anything: it records the gateway's reference and hands the customer a
   * checkout URL. The payment becomes `PAID` only when a signed callback arrives,
   * so returning from the redirect changes nothing on its own.
   */
  async startGatewayCheckout(input: {
    customerId: string;
    bookingId: string;
    method: GatewayMethod;
  }): Promise<GatewayCheckoutDto> {
    if (!this.config.paymentOnlineProvider) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Online payment is not available. Choose a different method.',
      });
    }
    /*
     * The provider name is not enough: a deployment can name a gateway and still
     * have nothing to sign with, in which case every callback would fail
     * verification and the customer would be stuck at "processing" with no way to
     * recover. Refused up front, with the same message as "not available", because
     * from the customer's side the two are the same thing.
     */
    if (!this.gateway.isConfigured()) {
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
        customer: { select: { email: true } },
        // The agreed price, not the service's current one - see startPayment.
        priceAmount: true,
        currency: true,
        payment: { select: { id: true, status: true, method: true } },
      },
    });
    if (!booking) throw bookingNotFound();

    // Idempotent per booking, exactly like the other payment paths: asking twice
    // is refused rather than creating a competing charge.
    if (booking.payment && booking.payment.status !== 'FAILED') {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'A payment is already in progress for this booking.',
      });
    }

    const status = booking.status as BookingStatus;
    if (!PAYABLE_STATUSES.includes(status)) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `A booking can only be paid after it is confirmed. This one is ${status}.`,
      });
    }

    const amount = booking.priceAmount.toNumber();
    const checkout = await this.gateway.createCheckout({
      reference: booking.reference,
      amount,
      currency: booking.currency,
      method: input.method,
      customerEmail: booking.customer.email,
    });

    const payment = await this.prisma.$transaction(async (transaction) => {
      const record = await transaction.payment.upsert({
        where: { bookingId: booking.id },
        update: {
          status: PAYMENT_STATUSES.PROCESSING,
          method: PAYMENT_METHODS.ONLINE,
          provider: checkout.provider,
          gatewayTransactionId: checkout.gatewayTransactionId,
          gatewayMethod: input.method,
          // Not verified until a signed callback says so.
          gatewayVerified: false,
          failureReason: null,
        },
        create: {
          bookingId: booking.id,
          // The agreed amount from the booking snapshot - never from the request.
          amount: booking.priceAmount,
          currency: booking.currency,
          method: PAYMENT_METHODS.ONLINE,
          status: PAYMENT_STATUSES.PROCESSING,
          provider: checkout.provider,
          gatewayTransactionId: checkout.gatewayTransactionId,
          gatewayMethod: input.method,
        },
      });

      // Append-only, so a retried checkout is visible rather than overwritten.
      await transaction.paymentAttempt.create({
        data: {
          paymentId: record.id,
          method: PAYMENT_METHODS.ONLINE,
          status: PAYMENT_STATUSES.PROCESSING,
          provider: checkout.provider,
          reference: checkout.gatewayTransactionId,
          note: `Checkout opened for ${input.method}.`,
        },
      });
      return record;
    });

    if (status !== BOOKING_STATUSES.PAYMENT_PENDING) {
      await this.lifecycle.applyPaymentPending({
        bookingId: booking.id,
        customerId: input.customerId,
        actorUserId: input.customerId,
      });
    }

    return {
      paymentId: payment.id,
      bookingId: booking.id,
      bookingReference: booking.reference,
      provider: checkout.provider,
      checkoutUrl: checkout.checkoutUrl,
      gatewayTransactionId: checkout.gatewayTransactionId,
      instrument: input.method,
      amount,
      currency: booking.currency,
      expiresAt: checkout.expiresAt.toISOString(),
      // Never true here: a checkout is not a payment.
      verified: false,
    };
  }

  /**
   * Applies a gateway callback.
   *
   * The signature is verified by the gateway provider first, so nothing here
   * trusts the payload on its own. Processing is idempotent per provider event
   * id, because gateways retry callbacks routinely and a retry must not pay a
   * booking twice. The amount is re-checked against the stored payment too: a
   * callback for a different amount is not proof that *this* booking was paid.
   *
   * The event is recorded only *after* its outcome has been applied. A retry
   * that arrives before that - because the previous attempt failed part-way -
   * must be reprocessed, not swallowed: swallowing it would leave the payment
   * un-settled with no way to recover, because the event that would settle it
   * has already been consumed.
   */
  async handleGatewayWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<{ applied: boolean; duplicate: boolean; outcome: string }> {
    this.gateway.verifyWebhook(rawBody, signature);
    const event = this.gateway.parseWebhook(rawBody);

    if (!event.providerEventId) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'The payment callback did not carry an event id.',
      });
    }

    // The unique event id is the idempotency key. Reading it before any write
    // means a callback we have already applied is recognised immediately,
    // without consuming the event for a *future* attempt.
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { providerEventId: event.providerEventId },
    });
    if (existing) {
      return { applied: false, duplicate: true, outcome: event.outcome };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayTransactionId: event.gatewayTransactionId },
      select: {
        id: true,
        bookingId: true,
        amount: true,
        status: true,
        booking: { select: { reference: true, customerId: true, status: true } },
      },
    });
    if (!payment) {
      // Nothing to settle yet, but the callback is still recorded so a
      // retry is recognised rather than reprocessed forever.
      await this.recordWebhookEvent(event, null);
      return { applied: false, duplicate: false, outcome: event.outcome };
    }

    /*
     * Only a payment that is still in flight may be moved by a callback.
     *
     * The check is here, before *any* write, rather than only on the success path:
     * gateways redeliver out of order, so a late `FAILED` or `PENDING` callback can
     * arrive long after the payment reached an outcome. `PAID` is the obvious case -
     * an unguarded write there un-settles a completed payment while the booking
     * still reads `PAID`, recording money as lost that was in fact taken. But the
     * later outcomes are worse: a `REFUNDED` payment marked `FAILED` by a late
     * callback erases the refund and tells the customer their money was lost when it
     * was returned to them, and a payment held by a dispute is not the gateway's to
     * rewrite either. Every branch below therefore claims the payment with the same
     * in-flight guard and reports "nothing to do" when the claim matches nothing.
     */
    if (!IN_FLIGHT_PAYMENT_STATUSES.includes(payment.status)) {
      await this.recordWebhookEvent(event, payment.id);
      return { applied: false, duplicate: false, outcome: event.outcome };
    }

    // An amount mismatch is not proof of payment for this booking.
    if (Math.abs(payment.amount.toNumber() - event.amount) > 0.009) {
      const failed = await this.prisma.payment.updateMany({
        where: { id: payment.id, ...claimableByInFlightPayment() },
        data: {
          status: PAYMENT_STATUSES.FAILED,
          failureReason: 'The gateway reported a different amount than the booking.',
        },
      });
      if (failed.count !== 1) {
        return { applied: false, duplicate: false, outcome: event.outcome };
      }
      // The mismatch is a payment failure, so it belongs in the attempt
      // history and in the customer's notifications, exactly like a
      // gateway-reported failure would.
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: PAYMENT_METHODS.ONLINE,
          status: PAYMENT_STATUSES.FAILED,
          provider: event.provider,
          reference: event.providerEventId,
          note: 'Gateway callback reported a different amount than the booking.',
        },
      });
      await this.recordWebhookEvent(event, payment.id);
      await this.notifications.emit([
        this.notifications.customerBookingEvent({
          type: NOTIFICATION_TYPES.PAYMENT_FAILED,
          customerUserId: payment.booking.customerId,
          bookingId: payment.bookingId,
          bookingReference: payment.booking.reference,
          professionalName: 'Your professional',
        }),
      ]);
      return { applied: true, duplicate: false, outcome: event.outcome };
    }

    if (event.outcome !== 'SUCCEEDED') {
      const recorded = await this.prisma.payment.updateMany({
        where: { id: payment.id, ...claimableByInFlightPayment() },
        data: {
          status:
            event.outcome === 'FAILED' ? PAYMENT_STATUSES.FAILED : PAYMENT_STATUSES.PROCESSING,
          failureReason: event.outcome === 'FAILED' ? 'The gateway reported a failure.' : null,
        },
      });
      // Another callback settled the payment while this one was being handled, so
      // the guarded write above matched nothing and there is nothing to record.
      if (recorded.count !== 1) {
        return { applied: false, duplicate: false, outcome: event.outcome };
      }
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: PAYMENT_METHODS.ONLINE,
          status:
            event.outcome === 'FAILED' ? PAYMENT_STATUSES.FAILED : PAYMENT_STATUSES.PROCESSING,
          provider: event.provider,
          reference: event.providerEventId,
          note: `Gateway callback: ${event.outcome}.`,
        },
      });
      await this.recordWebhookEvent(event, payment.id);
      // A gateway-reported failure is the customer's to know about. A
      // `PENDING` callback is not, so it is recorded without a
      // notification.
      if (event.outcome === 'FAILED') {
        await this.notifications.emit([
          this.notifications.customerBookingEvent({
            type: NOTIFICATION_TYPES.PAYMENT_FAILED,
            customerUserId: payment.booking.customerId,
            bookingId: payment.bookingId,
            bookingReference: payment.booking.reference,
            professionalName: 'Your professional',
          }),
        ]);
      }
      return { applied: true, duplicate: false, outcome: event.outcome };
    }

    const settled = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.payment.updateMany({
        where: { id: payment.id, ...claimableByInFlightPayment() },
        data: {
          status: PAYMENT_STATUSES.PAID,
          paidAt: new Date(),
          failureReason: null,
          // This verified callback is the only path that sets this flag.
          gatewayVerified: true,
        },
      });
      // The payment reached an outcome between the read above and this write -
      // another callback settled it, or it was refunded while this one was in
      // flight. Nothing to settle, so nothing is claimed and no event is burned:
      // the retry stays reprocessable.
      if (claimed.count !== 1) return false;

      await transaction.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          method: PAYMENT_METHODS.ONLINE,
          status: PAYMENT_STATUSES.PAID,
          provider: event.provider,
          reference: event.providerEventId,
          note: 'Settled by a verified gateway callback.',
        },
      });

      await transaction.bookingStatusHistory.create({
        data: {
          bookingId: payment.bookingId,
          fromStatus: payment.booking.status,
          toStatus: BOOKING_STATUSES.PAID,
          // The provider is not a user, so the step is attributed to the
          // customer whose money moved rather than to an invented account.
          actorUserId: payment.booking.customerId,
          isOverride: true,
        },
      });

      const moved = await transaction.booking.updateMany({
        where: { id: payment.bookingId, status: BOOKING_STATUSES.PAYMENT_PENDING },
        data: { status: BOOKING_STATUSES.PAID },
      });
      if (moved.count !== 1) {
        throw new BadRequestException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This booking is no longer awaiting payment.',
        });
      }

      /*
       * Recorded inside the transaction, so it commits with the settlement.
       * If anything above throws and the transaction rolls back, the event is
       * not recorded either, and a retried callback is reprocessed instead of
       * being mistaken for a duplicate that has already been applied.
       */
      await transaction.paymentWebhookEvent.create({
        data: {
          providerEventId: event.providerEventId,
          provider: event.provider,
          outcome: event.outcome,
          paymentId: payment.id,
        },
      });

      return true;
    });

    // A callback that settled nothing must not tell the customer their money was
    // taken: it either lost the race or arrived after the payment had already
    // reached an outcome that somebody else is answerable for.
    if (!settled) {
      return { applied: false, duplicate: false, outcome: event.outcome };
    }

    await this.notifications.emit([
      this.notifications.customerBookingEvent({
        type: NOTIFICATION_TYPES.PAYMENT_PAID,
        customerUserId: payment.booking.customerId,
        bookingId: payment.bookingId,
        bookingReference: payment.booking.reference,
        professionalName: 'Your professional',
      }),
    ]);

    return { applied: true, duplicate: false, outcome: event.outcome };
  }

  /**
   * Records a gateway callback once its outcome has been applied.
   *
   * The unique constraint on `providerEventId` is what makes a concurrent
   * callback with the same event id a no-op: the second writer loses the race
   * and is ignored here. Recording happens after the outcome is applied, so a
   * failed attempt never consumes the event it was trying to apply.
   */
  private async recordWebhookEvent(
    event: { providerEventId: string; provider: string; outcome: string },
    paymentId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          providerEventId: event.providerEventId,
          provider: event.provider,
          outcome: event.outcome,
          ...(paymentId ? { paymentId } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Everything known about a booking's payment, for either party.
   *
   * The attempt log is included so a retry is visible as its own row rather than
   * overwriting the previous reference, and `gatewayVerified` makes the
   * difference between a provider-settled payment and a merely recorded one
   * impossible to miss in the UI.
   */
  async history(
    bookingId: string,
    scope: { userId: string; role: 'CUSTOMER' | 'PROFESSIONAL' },
  ): Promise<PaymentHistoryDto> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        bookingId,
        ...(scope.role === 'CUSTOMER'
          ? { booking: { customerId: scope.userId } }
          : { booking: { professional: { userId: scope.userId } } }),
      },
      select: {
        ...PAYMENT_SELECT,
        attempts: { orderBy: { createdAt: 'asc' } },
        booking: { select: { reference: true } },
      },
    });

    if (!payment) {
      // A booking with no payment yet is a valid, non-error answer.
      return {
        payment: null,
        attempts: [],
        cash: null,
        gatewayVerified: false,
        gatewayTransactionId: null,
      };
    }

    return {
      // Always the full customer shape, so amount, method and failure reason are
      // present for either role; the role only changes the cash view.
      payment: toCustomerDto(payment, scope.userId),
      attempts: payment.attempts.map((attempt) => ({
        id: attempt.id,
        method: attempt.method,
        status: attempt.status,
        provider: attempt.provider,
        reference: attempt.reference,
        note: attempt.note,
        createdAt: attempt.createdAt.toISOString(),
      })),
      cash: toCashDto(payment, { userId: scope.userId, role: scope.role }),
      gatewayVerified: payment.gatewayVerified,
      gatewayTransactionId: payment.gatewayTransactionId,
    };
  }

  /**
   * The assigned professional confirms they received a direct payment.
   *
   * This is still a claim, not a settlement - the money moved outside the
   * platform - so it records who confirmed it and when, and it is only reachable
   * for `DIRECT` payments. An online payment is never settled through this path;
   * only a verified provider callback can do that.
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
    if (payment.status === PAYMENT_STATUSES.PAID) {
      // Already recorded: a second confirmation is a no-op, not an error.
      return this.getForProfessional(input.professionalUserId, input.bookingId);
    }
    /*
     * A payment that has already reached an outcome cannot be stamped received
     * afterwards.
     *
     * This is the same late-write hazard a redelivered gateway callback carries,
     * on a path with no gateway to make it late: a refunded or disputed payment is
     * money the professional is not confirming, and re-stamping it would erase the
     * outcome that finance and the other party are working from. `FAILED` is
     * refused the same way and recovered by starting a fresh payment, not by
     * re-confirming the row that failed.
     */
    /*
     * A payment that has already reached an outcome cannot be stamped received
     * afterwards.
     *
     * This is the same late-write hazard a redelivered gateway callback carries,
     * on a path with no gateway to make it late: a refunded or disputed payment is
     * money the professional is not confirming, and re-stamping it would erase the
     * outcome that finance and the other party are working from. `FAILED` is
     * refused the same way and recovered by starting a fresh payment, not by
     * re-confirming the row that failed.
     */
    if (!IN_FLIGHT_PAYMENT_STATUSES.includes(payment.status)) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: `This payment is ${payment.status.toLowerCase()} and can no longer be recorded as received.`,
      });
    }

    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.payment.updateMany({
        where: { id: payment.id, ...claimableByInFlightPayment() },
        data: { status: 'PAID', paidAt: new Date(), failureReason: null },
      });
      if (claimed.count !== 1) {
        // The read above happened outside this transaction, so the payment may
        // have reached its outcome while this write was on its way. Refused here
        // rather than reported as missing: there is a payment, it is just final.
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This payment has already reached a final state.',
        });
      }

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
  gatewayTransactionId: true,
  gatewayMethod: true,
  gatewayVerified: true,
  cashConfirmedByCustomerId: true,
  cashConfirmedByCustomerAt: true,
  cashConfirmedByCustomer: { select: { fullName: true } },
  cashConfirmedByProfessionalId: true,
  cashConfirmedByProfessionalAt: true,
  cashConfirmedByProfessional: { select: { fullName: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRecord = Prisma.PaymentGetPayload<{
  select: typeof PAYMENT_SELECT & { booking: { select: { reference: true } } };
}>;

/**
 * The cash state, derived from both confirmation timestamps.
 *
 * A single confirmation is a claim, so `isSettled` stays false and the booking
 * is not paid until the other party agrees. `awaitingViewerConfirmation` is
 * resolved per viewer so the app never has to work out whose turn it is.
 */
function toCashDto(
  payment: PaymentRecord,
  viewer: { userId: string; role: 'CUSTOMER' | 'PROFESSIONAL' },
): CashConfirmationDto | null {
  if (payment.method !== PAYMENT_METHODS.CASH) return null;
  const customerConfirmedAt = payment.cashConfirmedByCustomerAt?.toISOString() ?? null;
  const professionalConfirmedAt = payment.cashConfirmedByProfessionalAt?.toISOString() ?? null;
  // The confirmations are matched to the viewer by their stored id, not by
  // position, so a customer's own confirmation is never shown as the
  // professional's.
  const viewerConfirmed =
    viewer.role === 'CUSTOMER'
      ? payment.cashConfirmedByCustomerId === viewer.userId
      : payment.cashConfirmedByProfessionalId === viewer.userId;

  return {
    customerConfirmedAt,
    customerConfirmedByName: payment.cashConfirmedByCustomer?.fullName ?? null,
    professionalConfirmedAt,
    professionalConfirmedByName: payment.cashConfirmedByProfessional?.fullName ?? null,
    isSettled: isCashFullyConfirmed({ customerConfirmedAt, professionalConfirmedAt }),
    awaitingViewerConfirmation: !viewerConfirmed,
  };
}

function toCustomerDto(payment: PaymentRecord, viewerUserId: string): BookingPaymentDto {
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
    gatewayVerified: payment.gatewayVerified,
    gatewayTransactionId: payment.gatewayTransactionId,
    gatewayMethod: payment.gatewayMethod,
    cash: toCashDto(payment, { userId: viewerUserId, role: 'CUSTOMER' }),
  };
}

function toProfessionalDto(payment: PaymentRecord, viewerUserId: string): ProfessionalPaymentDto {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    bookingReference: payment.booking.reference,
    amount: payment.amount.toNumber(),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
    gatewayVerified: payment.gatewayVerified,
    gatewayTransactionId: payment.gatewayTransactionId,
    cash: toCashDto(payment, { userId: viewerUserId, role: 'PROFESSIONAL' }),
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

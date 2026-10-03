import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { API_ERROR_CODES, PAYMENT_METHODS, ROLES } from '@helpzy/types';
import {
  confirmCashPaymentSchema,
  recordDirectPaymentSchema,
  startGatewayCheckoutSchema,
  startPaymentSchema,
} from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaymentsService } from './payments.service';

/**
 * Customer payment endpoints. A booking's payment is always addressed through
 * the booking id, and the party is resolved from the session - there is no way to
 * name a different customer or professional in the request.
 */
@Controller('customer/payments')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** What this deployment can actually do, so the app can hide dead options. */
  @Get('capabilities')
  capabilities() {
    return this.payments.getCapabilities();
  }

  @Get(':bookingId')
  get(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.payments.getForCustomer(request.user!.id, bookingId);
  }

  @Post(':bookingId')
  start(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = startPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.payments.startPayment({
      customerId: request.user!.id,
      bookingId,
      method: parsed.data.method,
    });
  }

  /** The full payment record, attempts and cash state for this booking. */
  @Get(':bookingId/history')
  history(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.payments.history(bookingId, {
      userId: request.user!.id,
      role: ROLES.CUSTOMER,
    });
  }

  /**
   * Records that the customer handed over cash.
   *
   * One of two required confirmations: the payment is only settled once the
   * professional agrees as well, so this can never mark cash as received alone.
   */
  @Post(':bookingId/cash/confirm')
  confirmCash(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = confirmCashPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.payments.confirmCashPayment({
      actorUserId: request.user!.id,
      actorRole: ROLES.CUSTOMER,
      bookingId,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
  }

  /**
   * Opens a gateway checkout.
   *
   * Returns a checkout URL and the gateway's reference. It settles nothing: the
   * payment is marked paid only by a signed provider callback, so returning from
   * the redirect proves nothing on its own.
   */
  @Post(':bookingId/checkout')
  checkout(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = startGatewayCheckoutSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.payments.startGatewayCheckout({
      customerId: request.user!.id,
      bookingId,
      method: parsed.data.method,
    });
  }
}

/**
 * The professional's payment endpoints.
 *
 * Separate controller because the roles differ: a professional records a direct
 * payment receipt, and must never be able to start one on the customer's behalf.
 */
@Controller('professional/payments')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':bookingId')
  get(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.payments.getForProfessional(request.user!.id, bookingId);
  }

  /** The full payment record, attempts and cash state for this booking. */
  @Get(':bookingId/history')
  history(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.payments.history(bookingId, {
      userId: request.user!.id,
      role: ROLES.PROFESSIONAL,
    });
  }

  /**
   * Records that the professional received cash.
   *
   * The second of the two required confirmations. Settling still needs the
   * customer's agreement, so this alone cannot mark cash as received.
   */
  @Post(':bookingId/cash/confirm')
  confirmCash(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = confirmCashPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.payments.confirmCashPayment({
      actorUserId: request.user!.id,
      actorRole: ROLES.PROFESSIONAL,
      bookingId,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
  }

  @Post(':bookingId/direct')
  recordDirect(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = recordDirectPaymentSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.payments.recordDirectPayment({
      professionalUserId: request.user!.id,
      bookingId,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
  }
}

/**
 * The gateway's own callback endpoint.
 *
 * Deliberately unauthenticated - the provider has no HELPZY session - and
 * therefore the only thing that makes it safe is the HMAC signature check
 * inside the gateway provider, applied before the payload is parsed at all. It
 * reads the raw request body, because a signature is computed over the exact
 * bytes sent and re-serialising the parsed JSON would change them.
 */
@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-helpzy-signature') signature: string | undefined,
  ) {
    if (!signature) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'The payment callback did not carry a signature.',
      });
    }
    return this.payments.handleGatewayWebhook(request.rawBody ?? Buffer.alloc(0), signature);
  }
}

function validationFailure(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Please check the details and try again.',
    details: issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      messages: [issue.message],
    })),
  });
}

export { PAYMENT_METHODS };

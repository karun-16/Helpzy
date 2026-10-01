import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, PAYMENT_METHODS, ROLES } from '@helpzy/types';
import { recordDirectPaymentSchema, startPaymentSchema } from '@helpzy/validation';

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

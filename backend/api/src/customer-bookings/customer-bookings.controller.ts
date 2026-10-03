import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import { markCompletedSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CustomerBookingsService } from './customer-bookings.service';

@Controller('customer/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerBookingsController {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  @Post()
  create(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.bookingsService.create(request.user!.id, body);
  }

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.bookingsService.list(request.user!.id);
  }

  /** The real recorded status transitions for this booking. */
  @Get(':bookingId/timeline')
  timeline(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.timeline(request.user!.id, bookingId);
  }

  @Get(':bookingId')
  get(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.get(request.user!.id, bookingId);
  }

  @Post(':bookingId/confirm')
  confirm(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.confirmCompletion(request.user!.id, bookingId);
  }

  /**
   * The customer's half of mutual completion.
   *
   * The first confirmation from either party only records agreement; the booking
   * becomes complete once both have confirmed.
   */
  @Post(':bookingId/complete')
  async complete(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = markCompletedSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.bookingsService.markCompleted(request.user!.id, bookingId, parsed.data.note);
  }

  /** Who has confirmed completion, and whether the customer still owes theirs. */
  @Get(':bookingId/completion')
  completion(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.completionState(request.user!.id, bookingId);
  }

  @Post(':bookingId/cancel')
  cancel(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.cancel(request.user!.id, bookingId);
  }

  /**
   * Closes a paid booking.
   *
   * The customer's final step: a booking is only closed once the
   * customer who holds it confirms the paid work is wrapped up.
   */
  @Post(':bookingId/close')
  close(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.close(request.user!.id, bookingId);
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

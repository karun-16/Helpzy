import { Module } from '@nestjs/common';
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
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import { decideRescheduleSchema, requestRescheduleSchema } from '@helpzy/validation';

import { AuthModule } from '../auth/auth.module';
import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { RescheduleService } from './reschedule.service';

/**
 * Rescheduling, for either party to a booking.
 *
 * Both roles are accepted on the same controller because the rules are identical
 * for the customer and the professional: the service resolves which of them is
 * which from the booking, so there is no route where one role can act as the
 * other. A user who is not a party to the booking gets "not found".
 */
@Controller('bookings/:bookingId/reschedule')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER, ROLES.PROFESSIONAL)
export class RescheduleController {
  constructor(private readonly reschedule: RescheduleService) {}

  /** The full proposal history, newest first. */
  @Get()
  list(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.reschedule.list(bookingId, { userId: request.user!.id });
  }

  /** The live proposal and what this viewer may do with it. */
  @Get('state')
  state(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.reschedule.state(bookingId, { userId: request.user!.id });
  }

  @Post()
  request(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = requestRescheduleSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.reschedule.request(
      bookingId,
      { userId: request.user!.id },
      {
        proposedStart: new Date(parsed.data.proposedStart),
        ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      },
    );
  }

  @Post('decide')
  decide(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = decideRescheduleSchema.safeParse(body);
    if (!parsed.success) throw validationFailure(parsed.error.issues);
    return this.reschedule.decide(
      bookingId,
      { userId: request.user!.id },
      {
        decision: parsed.data.decision,
        ...(parsed.data.decisionNote !== undefined
          ? { decisionNote: parsed.data.decisionNote }
          : {}),
      },
    );
  }

  @Post('withdraw')
  withdraw(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.reschedule.withdraw(bookingId, { userId: request.user!.id });
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

/**
 * The shared booking status machine and the rescheduling flow.
 *
 * Exported so the professional and customer booking feature modules can both
 * apply transitions and reschedule rules without duplicating the ordering and
 * ownership logic.
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [RescheduleController],
  providers: [BookingLifecycleService, RescheduleService],
  exports: [BookingLifecycleService, RescheduleService],
})
export class BookingLifecycleModule {}

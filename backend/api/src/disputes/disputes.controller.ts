import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { disputeMessageSchema, openDisputeSchema, resolveDisputeSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DisputesService } from './disputes.service';

/**
 * Disputes over a booking.
 *
 * Both participants use the same routes. Every handler re-checks that the caller
 * is a party to the booking rather than trusting the id in the path, and a
 * booking belonging to somebody else comes back as 404 so these endpoints cannot
 * be used to probe for other people's bookings.
 */
@Controller('bookings/:bookingId/dispute')
@UseGuards(AuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  open(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    return this.disputes.open(request.user!.id, bookingId, openDisputeSchema.parse(body));
  }

  @Get()
  get(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.disputes.forBooking(request.user!, bookingId);
  }
}

/** Messages and admin adjudication, split out because the guards differ. */
@Controller('disputes/:disputeId')
@UseGuards(AuthGuard)
export class DisputeMessagesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post('messages')
  send(
    @Req() request: RequestWithUser,
    @Param('disputeId') disputeId: string,
    @Body() body: unknown,
  ) {
    const { body: text } = disputeMessageSchema.parse(body);
    return this.disputes.addMessage(request.user!, disputeId, text);
  }
}

@Controller('admin/disputes')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query('status') status?: string, @Query('search') search?: string) {
    return this.disputes.list({ ...(status ? { status } : {}), ...(search ? { search } : {}) });
  }

  @Get(':disputeId')
  get(@Param('disputeId') disputeId: string) {
    return this.disputes.detailForAdmin(disputeId);
  }

  @Patch(':disputeId/review')
  startReview(@Req() request: RequestWithUser, @Param('disputeId') disputeId: string) {
    return this.disputes.startReview(request.user!.id, disputeId);
  }

  @Patch(':disputeId/resolve')
  resolve(
    @Req() request: RequestWithUser,
    @Param('disputeId') disputeId: string,
    @Body() body: unknown,
  ) {
    return this.disputes.resolve(request.user!.id, disputeId, resolveDisputeSchema.parse(body));
  }
}

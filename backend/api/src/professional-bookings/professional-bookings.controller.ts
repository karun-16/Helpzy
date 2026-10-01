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

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  isProfessionalLifecycleStatus,
  PROFESSIONAL_LIFECYCLE_ACTIONS,
} from '../bookings/booking-lifecycle';
import { ProfessionalBookingsService } from './professional-bookings.service';

@Controller('professional/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalBookingsController {
  constructor(private readonly bookingsService: ProfessionalBookingsService) {}

  @Get()
  listIncoming(@Req() request: RequestWithUser) {
    return this.bookingsService.listIncoming(request.user!.id);
  }

  /**
   * "My Jobs": everything assigned to this professional, grouped into upcoming,
   * active and completed. Declared before `:bookingId` so it is not swallowed by
   * the parameterised route.
   */
  @Get('my-jobs')
  listMyJobs(@Req() request: RequestWithUser) {
    return this.bookingsService.listMyJobs(request.user!.id);
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

  @Post(':bookingId/accept')
  accept(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.decide(request.user!.id, bookingId, 'ACCEPTED');
  }

  @Post(':bookingId/reject')
  reject(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.bookingsService.decide(request.user!.id, bookingId, 'REJECTED');
  }

  /**
   * Single entry point for the professional-controlled lifecycle steps. The
   * action is validated against the shared state machine, so an out-of-order or
   * customer-owned action is rejected server-side.
   */
  @Post(':bookingId/advance')
  advance(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: { action?: unknown },
  ) {
    const action = body?.action;
    if (typeof action !== 'string' || !isProfessionalLifecycleStatus(action)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `Choose one of: ${PROFESSIONAL_LIFECYCLE_ACTIONS.join(', ')}.`,
      });
    }
    return this.bookingsService.advance(request.user!.id, bookingId, action);
  }
}

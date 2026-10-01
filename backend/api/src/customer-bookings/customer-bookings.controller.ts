import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';

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
}

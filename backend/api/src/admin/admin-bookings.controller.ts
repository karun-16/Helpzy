import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { overrideBookingStatusSchema, refundBookingSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminBookingsService } from './admin-bookings.service';

/**
 * Administrative oversight of a single booking.
 *
 * Separate from `AdminController`'s booking list because these routes can change
 * money and state, and they deserve to be read on their own: each one requires a
 * written reason, and the reasons are what the audit trail is made of.
 */
@Controller('admin/bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get(':bookingId')
  detail(@Param('bookingId') bookingId: string) {
    return this.bookings.detail(bookingId);
  }

  @Patch(':bookingId/status')
  overrideStatus(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    return this.bookings.overrideStatus(
      request.user!.id,
      bookingId,
      overrideBookingStatusSchema.parse(body),
    );
  }

  @Patch(':bookingId/refund')
  refund(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    return this.bookings.refund(request.user!.id, bookingId, refundBookingSchema.parse(body));
  }
}

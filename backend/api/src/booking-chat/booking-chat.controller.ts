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
import { sendBookingMessageSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BookingChatService } from './booking-chat.service';

/**
 * One route for both sides of a booking's chat.
 *
 * A customer and a professional use the same endpoints; the service decides
 * whether the caller is a participant. Splitting this into two role-guarded
 * controllers would only duplicate the participant check, because the role alone
 * never proves the caller belongs to *this* booking.
 */
@Controller('bookings/:bookingId/messages')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER, ROLES.PROFESSIONAL)
export class BookingChatController {
  constructor(private readonly chat: BookingChatService) {}

  @Get()
  list(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.chat.list(request.user!.id, bookingId);
  }

  @Post()
  send(
    @Req() request: RequestWithUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const parsed = sendBookingMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Please check the message and try again.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }
    return this.chat.send(request.user!.id, bookingId, parsed.data);
  }
}

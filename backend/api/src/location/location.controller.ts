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
import { professionalLocationUpdateSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LocationService } from './location.service';

@Controller('professional/location')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalLocationController {
  constructor(private readonly location: LocationService) {}

  /**
   * Reports this device's position for this professional. The target is always
   * the session user, so a professional can only ever move themselves.
   */
  @Post()
  update(@Req() request: RequestWithUser, @Body() body: unknown) {
    const parsed = professionalLocationUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Those coordinates could not be read.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }
    return this.location.updateOwnLocation(request.user!.id, parsed.data);
  }
}

/**
 * The customer reads the assigned professional's position for one of their own
 * bookings. Route lives under the customer namespace so the role guard and the
 * ownership check agree on who may ask.
 */
@Controller('customer/bookings/:bookingId/location')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerLocationController {
  constructor(private readonly location: LocationService) {}

  @Get()
  get(@Req() request: RequestWithUser, @Param('bookingId') bookingId: string) {
    return this.location.getForBooking(request.user!.id, bookingId);
  }
}

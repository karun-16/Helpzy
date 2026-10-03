import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { updatePlatformSettingsSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Reading and writing platform settings.
 *
 * Split from the main admin controller for the same reason bookings oversight is:
 * this route changes rules the whole platform is measured against, so it is kept
 * somewhere an admin can be certain is the only place that writes them.
 */
@Controller('admin/settings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  async read() {
    const document = await this.settings.current();
    return this.settings.response(document, null);
  }

  @Patch()
  async update(@Req() request: RequestWithUser, @Body() body: unknown) {
    const patch = updatePlatformSettingsSchema.parse(body);
    return this.settings.update(request.user!.id, patch);
  }
}

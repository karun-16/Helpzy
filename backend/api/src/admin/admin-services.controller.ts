import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { setServiceStatusSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminServicesService } from './admin-services.service';

/** Admin moderation of individual service listings. */
@Controller('admin/services')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminServicesController {
  constructor(private readonly services: AdminServicesService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('onlyInactive') onlyInactive?: string,
  ) {
    return this.services.list({
      ...(search ? { search } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(onlyInactive === 'true' ? { onlyInactive: true } : {}),
    });
  }

  @Patch(':serviceId/status')
  setStatus(
    @Req() request: RequestWithUser,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ) {
    return this.services.setStatus(request.user!.id, serviceId, setServiceStatusSchema.parse(body));
  }
}

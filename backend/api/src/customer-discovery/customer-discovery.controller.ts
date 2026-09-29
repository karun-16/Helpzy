import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';

import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CustomerDiscoveryService } from './customer-discovery.service';

@Controller('customer')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerDiscoveryController {
  constructor(private readonly discoveryService: CustomerDiscoveryService) {}

  @Get('services')
  getCategories() {
    return this.discoveryService.getCategories();
  }

  @Get('services/:serviceId/professionals')
  getProfessionalsForService(@Param('serviceId') serviceId: string) {
    return this.discoveryService.getProfessionalsForService(serviceId);
  }

  @Get('professionals')
  getAvailableProfessionals() {
    return this.discoveryService.getAvailableProfessionals();
  }

  @Get('professionals/:professionalId')
  getProfessionalProfile(@Param('professionalId') professionalId: string) {
    return this.discoveryService.getProfessionalProfile(professionalId);
  }
}

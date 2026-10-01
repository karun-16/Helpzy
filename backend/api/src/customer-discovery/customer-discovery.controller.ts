import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CustomerDiscoveryService } from './customer-discovery.service';

/**
 * The public marketplace catalogue.
 *
 * Readable without a session and by every role, because `/` is one shared
 * marketplace: a guest browsing it, a customer signing in, and a professional
 * opening Marketplace from their header all get the same categories and
 * professionals. The response contains no customer data and no professional
 * contact detail that the professional has not published - a phone number
 * appears only when `isPhoneVisible` is set - so nothing private is exposed by
 * widening this. Booking, address and account routes stay behind `AuthGuard` and
 * `RolesGuard`.
 */
@Controller('customer')
@UseGuards(OptionalAuthGuard)
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

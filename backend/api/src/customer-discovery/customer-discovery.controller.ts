import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { LocationCatalogService } from '../location-catalog/location-catalog.service';
import { CustomerDiscoveryService } from './customer-discovery.service';

/**
 * The public marketplace.
 *
 * `OptionalAuthGuard` because the marketplace is browsable signed out - the
 * discovery pages are the project's front door.
 *
 * Every listing endpoint takes the same optional `?location=` slug. It is optional
 * rather than required so an existing caller keeps working, but the app always
 * sends one: the marketplace prompts for a location instead of loading an
 * unfiltered list. When a slug is supplied it is resolved and rejected if unknown,
 * and the filter is applied in SQL.
 */
@Controller('customer')
@UseGuards(OptionalAuthGuard)
export class CustomerDiscoveryController {
  constructor(
    private readonly discoveryService: CustomerDiscoveryService,
    private readonly locations: LocationCatalogService,
  ) {}

  @Get('services')
  async getCategories(@Query('location') location?: string) {
    const resolved = location ? await this.locations.requireForFilter(location) : null;
    return this.discoveryService.getCategories(resolved?.id ?? null);
  }

  @Get('services/:serviceId/professionals')
  async getProfessionalsForService(
    @Param('serviceId') serviceId: string,
    @Query('location') location?: string,
  ) {
    const resolved = location ? await this.locations.requireForFilter(location) : null;
    return this.discoveryService.getProfessionalsForService(serviceId, resolved?.id ?? null);
  }

  @Get('professionals')
  async getAvailableProfessionals(@Query('location') location?: string) {
    const resolved = location ? await this.locations.requireForFilter(location) : null;
    return this.discoveryService.getAvailableProfessionals(resolved?.id ?? null);
  }

  @Get('professionals/:professionalId')
  getProfessionalProfile(@Param('professionalId') professionalId: string) {
    return this.discoveryService.getProfessionalProfile(professionalId);
  }
}

import { Module } from '@nestjs/common';

import { LocationCatalogService } from './location-catalog.service';

/**
 * Resolves the marketplace location dataset into database rows.
 *
 * This module is the only place that answers "is this a real location?", so the
 * discovery filter, professional registration and profile editing cannot drift
 * apart in what they accept.
 */
@Module({
  providers: [LocationCatalogService],
  exports: [LocationCatalogService],
})
export class LocationCatalogModule {}

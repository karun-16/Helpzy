import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { findMarketplaceLocation } from '@helpzy/config';
import type { MarketplaceLocation } from '@helpzy/types';

import { PrismaService } from '../database/prisma.service';

/** The `locations` row a marketplace filter is expressed against. */
export interface ResolvedLocation {
  id: string;
  slug: string;
  state: string;
  district: string;
  city: string;
}

/**
 * Turns a location slug into a `locations` row.
 *
 * Validation happens in two deliberate stages, because they fail differently and
 * the operator needs to be able to tell them apart:
 *
 *  1. The slug is checked against the shared dataset in `@helpzy/config`. This is
 *     cheap, needs no database, and is the same array the picker rendered - so a
 *     place the customer could not have chosen is rejected here.
 *  2. The dataset entry is then resolved to a row. A dataset entry with no row
 *     means the location seed has not been run, which is an operator problem
 *     rather than a customer one, and is reported as a 503 instead of a 400.
 *
 * Nothing here trusts a caller-supplied name: a slug is resolved, never
 * interpolated into a query.
 */
@Injectable()
export class LocationCatalogService {
  private readonly logger = new Logger(LocationCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a slug for a *filter*. Rejects anything the dataset does not know.
   *
   * @throws BadRequestException when the slug is not a supported location.
   */
  async requireForFilter(slug: string): Promise<ResolvedLocation> {
    const known = findMarketplaceLocation(slug);
    if (!known) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'That location is not one HELPZY serves yet.',
      });
    }

    return this.resolveRow(known);
  }

  /**
   * Resolves an optional slug, used where "no location supplied" is meaningful:
   * a professional who has not chosen one yet.
   */
  async optional(slug: string | null | undefined): Promise<ResolvedLocation | null> {
    if (slug === null || slug === undefined || slug.trim() === '') return null;
    return this.requireForFilter(slug);
  }

  /** Public shape sent to clients. Never includes coordinates. */
  private toSummary(row: {
    id: string;
    slug: string;
    state: string;
    district: string;
    city: string;
  }): ResolvedLocation {
    return { id: row.id, slug: row.slug, state: row.state, district: row.district, city: row.city };
  }

  private async resolveRow(location: MarketplaceLocation): Promise<ResolvedLocation> {
    const row = await this.prisma.location.findUnique({ where: { slug: location.slug } });

    if (!row) {
      // Logged without coordinates: the slug alone identifies the missing place.
      this.logger.error(
        `Location "${location.slug}" is in the dataset but has no row in "locations". Run the location seed.`,
      );
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Location data is not ready yet. Please try again shortly.',
      });
    }

    return this.toSummary(row);
  }
}

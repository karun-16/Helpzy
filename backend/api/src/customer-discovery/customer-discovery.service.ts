import { Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BOOKING_STATUSES,
  PROFESSIONAL_VERIFICATION_STATUSES,
  ROLES,
  REVIEW_STATUSES,
  type CustomerProfessional,
  type CustomerProfessionalProfile,
  type CustomerServiceCategory,
} from '@helpzy/types';
import { professionalMarketplaceProfileSchema, workingHoursSchema } from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '@prisma/client';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

/**
 * Which professionals the marketplace will show.
 *
 * A method rather than a constant because one of the conditions is a platform
 * setting. Every public query composes this, so there is exactly one place that
 * decides who is discoverable - the alternative is four filters that can drift.
 *
 * `requireVerifiedForDiscovery` is off by default, which preserves the
 * marketplace's original behaviour: an active professional with an eligible
 * service is listed, and verification is displayed as a badge rather than used as
 * a gate. An operator can turn it on, at which point pending, unverified and
 * rejected professionals drop out of *listing* only. It never affects an existing
 * booking, and it never hides a professional from the admin review queues, which
 * use their own queries.
 *
 * Typed as Prisma's input rather than left to inference: `availableProfessionalFilter`
 * overrides `professionalProfile` to add the verification condition, and an inferred
 * literal type would narrow that field to `{ isNot: null }` and reject the extra key.
 */
/**
 * Only real, verifiable data reaches the customer-facing profile.
 *
 * A rating average is shown only when reviews actually exist, and a completion
 * count is derived from closed bookings rather than read from a stored field a
 * professional could edit. A new professional therefore appears with no rating
 * and zero completed jobs instead of a fabricated 5.0.
 */
@Injectable()
export class CustomerDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * The professional filter for public listing.
   *
   * `locationId` is the load-bearing clause: when the customer has chosen a
   * marketplace location, only professionals registered in that exact place can
   * satisfy this filter. The restriction is expressed in the query itself, so no
   * other professional's row is ever read and then discarded.
   *
   * A professional with no location is excluded by construction - a null
   * `locationId` cannot equal a resolved location - which is the honest outcome
   * for someone who has not told us where they work.
   *
   * When no location is supplied the profile condition is omitted entirely and the
   * unfiltered listing is byte-for-byte the query that shipped before locations
   * existed. That is deliberate: `location` is an optional parameter for
   * compatibility, so a caller that omits it must get the previous behaviour, and
   * the marketplace still never omits it.
   */
  private async availableProfessionalFilter(
    locationId: string | null,
  ): Promise<Prisma.UserWhereInput> {
    const base: Prisma.UserWhereInput = { role: ROLES.PROFESSIONAL, status: 'ACTIVE' };
    const { service } = await this.settings.current();
    const requireVerified = service.requireVerifiedForDiscovery;

    // Nothing to restrict by: the plain "has a profile" filter, unchanged.
    if (!locationId && !requireVerified) {
      return { ...base, professionalProfile: { isNot: null } };
    }

    const profileFilter: Prisma.ProfessionalProfileWhereInput = {
      ...(locationId ? { locationId } : {}),
      ...(requireVerified ? { verification: PROFESSIONAL_VERIFICATION_STATUSES.VERIFIED } : {}),
    };

    return {
      ...base,
      // `is` rather than `isNot: null` because Prisma will not accept a field
      // condition alongside `isNot`. `is` already implies the profile exists.
      professionalProfile: { is: profileFilter },
    };
  }

  async getCategories(locationId: string | null): Promise<CustomerServiceCategory[]> {
    const professional = await this.availableProfessionalFilter(locationId);
    const categories = await this.prisma.serviceCategory.findMany({
      where: {
        isActive: true,
        services: {
          some: {
            isActive: true,
            owner: { is: professional },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        iconUrl: true,
        services: {
          where: {
            isActive: true,
            owner: { is: professional },
          },
          orderBy: { title: 'asc' },
          select: { id: true, title: true, summary: true },
        },
      },
    });

    return categories;
  }

  async getProfessionalsForService(serviceId: string, locationId: string | null) {
    const professional = await this.availableProfessionalFilter(locationId);
    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        isActive: true,
        category: { isActive: true },
        owner: { is: professional },
      },
      select: {
        id: true,
        title: true,
        summary: true,
        category: { select: { id: true, slug: true, name: true } },
        owner: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            professionalProfile: { select: PROFILE_SUMMARY_SELECT },
          },
        },
      },
    });

    if (!service?.owner.professionalProfile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The selected service is no longer available.',
      });
    }

    const { owner, ...serviceDetails } = service;
    // The list view stays light; the full profile is fetched on demand.
    return {
      service: serviceDetails,
      professionals: [toProfessionalSummary(owner)],
    };
  }

  /**
   * A single professional's public profile.
   *
   * Deliberately *not* location-filtered: this is a direct link, not a listing, so
   * someone who was sent a professional's profile can still open it. Only the
   * existing availability rules apply. Nothing private is exposed here beyond what
   * the profile has always shown.
   */
  async getProfessionalProfile(professionalId: string) {
    const professional = await this.availableProfessionalFilter(null);
    const user = await this.prisma.user.findFirst({
      where: { id: professionalId, ...professional },
      select: {
        id: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        professionalProfile: { select: PROFILE_SUMMARY_SELECT },
        services: {
          where: { isActive: true, category: { isActive: true } },
          orderBy: { title: 'asc' },
          select: {
            id: true,
            title: true,
            summary: true,
            description: true,
            basePrice: true,
            currency: true,
            durationMinutes: true,
            category: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    if (!user?.professionalProfile) throw professionalNotFound();

    const [profile] = await this.hydrateMarketplaceProfiles([user]);
    if (!profile) throw professionalNotFound();
    return profile;
  }

  async getAvailableProfessionals(
    locationId: string | null,
  ): Promise<CustomerProfessionalProfile[]> {
    const professional = await this.availableProfessionalFilter(locationId);
    const users = await this.prisma.user.findMany({
      where: {
        ...professional,
        services: { some: { isActive: true, category: { isActive: true } } },
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        professionalProfile: { select: PROFILE_SUMMARY_SELECT },
        services: {
          where: { isActive: true, category: { isActive: true } },
          orderBy: { title: 'asc' },
          select: {
            id: true,
            title: true,
            summary: true,
            description: true,
            basePrice: true,
            currency: true,
            durationMinutes: true,
            category: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });

    return this.hydrateMarketplaceProfiles(users);
  }

  /**
   * Attaches the data that needs a second query - real reviews and a real
   * completed-booking count - to each professional summary.
   *
   * Batched so the list view stays a fixed number of round trips rather than
   * two per professional.
   */
  private async hydrateMarketplaceProfiles(
    users: Array<{
      id: string;
      fullName: string;
      phone: string | null;
      avatarUrl: string | null;
      professionalProfile: ProfileSummary | null;
      services: ServiceSummary[];
    }>,
  ): Promise<CustomerProfessionalProfile[]> {
    const eligible = users.filter((user) => user.professionalProfile !== null);
    if (eligible.length === 0) return [];

    const userIds = eligible.map((user) => user.id);

    const [reviewsByUser, completedCounts] = await Promise.all([
      this.recentReviewsByUser(userIds),
      this.completedCountsByUser(userIds),
    ]);

    return eligible.map((user) => {
      const profile = user.professionalProfile!;
      return {
        ...toProfessionalSummary(user),
        bio: profile.bio,
        avatarUrl: user.avatarUrl,
        ...(profile.isPhoneVisible && user.phone ? { phone: user.phone } : {}),
        contactEmail: profile.contactEmail,
        yearsOfExperience: profile.yearsOfExperience ?? undefined,
        workingHours: toWorkingHours(profile.workingHours),
        completedCount: completedCounts.get(user.id) ?? 0,
        reviews: reviewsByUser.get(user.id) ?? [],
        services: user.services,
        offerings: user.services.map(toOffering),
      };
    });
  }

  private async recentReviewsByUser(userIds: string[]) {
    // Reviews belong to a booking, and a booking belongs to a professional
    // profile, so the professional is reached through `booking.professional`.
    const reviews = await this.prisma.review.findMany({
      where: {
        status: REVIEW_STATUSES.PUBLISHED,
        booking: { professional: { userId: { in: userIds } } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        booking: {
          select: {
            professional: { select: { userId: true } },
            service: { select: { title: true } },
          },
        },
        customer: { select: { fullName: true } },
      },
    });

    // Keep each professional's list short while still ordering globally.
    const perUser = new Map<string, CustomerProfessionalProfile['reviews']>();
    for (const review of reviews) {
      const ownerId = review.booking.professional.userId;
      const bucket = perUser.get(ownerId) ?? [];
      if (bucket.length >= MAX_REVIEWS_PER_PROFESSIONAL) continue;
      bucket.push({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        // Only the first name is public; a review is not permission to publish
        // a customer's full name.
        customerName: firstNameOnly(review.customer.fullName),
        serviceTitle: review.booking.service?.title ?? '',
        createdAt: review.createdAt.toISOString(),
      });
      perUser.set(ownerId, bucket);
    }
    return perUser;
  }

  private async completedCountsByUser(userIds: string[]) {
    // Grouped in the database rather than by loading every booking row.
    const grouped = await this.prisma.booking.groupBy({
      by: ['professionalId'],
      where: {
        status: BOOKING_STATUSES.CLOSED,
        professional: { userId: { in: userIds } },
      },
      _count: { _all: true },
    });

    const professionalUserIds = await this.prisma.professionalProfile.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true },
    });
    const userIdByProfileId = new Map(professionalUserIds.map((p) => [p.id, p.userId]));

    const counts = new Map<string, number>();
    for (const row of grouped) {
      const userId = userIdByProfileId.get(row.professionalId);
      if (userId) counts.set(userId, row._count._all);
    }
    return counts;
  }
}

const MAX_REVIEWS_PER_PROFESSIONAL = 20;

const PROFILE_SUMMARY_SELECT = {
  businessName: true,
  bio: true,
  verification: true,
  serviceArea: true,
  // The four display fields only - never `latitude`/`longitude`. A customer's
  // marketplace does not need a professional's city centroid.
  location: { select: { slug: true, state: true, district: true, city: true } },
  averageRating: true,
  ratingCount: true,
  contactEmail: true,
  isPhoneVisible: true,
  yearsOfExperience: true,
  workingHours: true,
} as const;

type ProfileSummary = {
  businessName: string;
  bio: string | null;
  verification: CustomerProfessional['verification'];
  serviceArea: string | null;
  location: { slug: string; state: string; district: string; city: string } | null;
  averageRating: { toNumber: () => number };
  ratingCount: number;
  contactEmail: string | null;
  isPhoneVisible: boolean;
  yearsOfExperience: number | null;
  workingHours: unknown;
};

type ServiceSummary = {
  id: string;
  title: string;
  summary: string | null;
  description: string;
  basePrice: { toNumber: () => number };
  currency: string;
  durationMinutes: number;
  category: { id: string; slug: string; name: string };
};

function toProfessionalSummary(user: {
  id: string;
  fullName: string;
  phone?: string | null;
  professionalProfile: ProfileSummary | null;
}): CustomerProfessional {
  const profile = user.professionalProfile;
  if (!profile) throw professionalNotFound();

  return {
    id: user.id,
    fullName: user.fullName,
    businessName: profile.businessName,
    bio: profile.bio,
    verification: profile.verification,
    serviceArea: profile.serviceArea,
    location: profile.location,
    // An unrated professional has no average at all. Inventing 0.0 would read as
    // "terrible reviews" rather than "no reviews yet".
    ...(profile.ratingCount > 0
      ? { averageRating: profile.averageRating.toNumber(), ratingCount: profile.ratingCount }
      : {}),
    ...(profile.contactEmail ? { contactEmail: profile.contactEmail } : {}),
    ...(profile.yearsOfExperience !== null ? { yearsOfExperience: profile.yearsOfExperience } : {}),
    ...(profile.isPhoneVisible && user.phone ? { phone: user.phone } : {}),
  };
}

function toOffering(service: ServiceSummary) {
  return {
    ...service,
    description: service.description,
    priceAmount: service.basePrice.toNumber(),
  };
}

/**
 * The working-hours column is `Json`, so its shape is only guaranteed at
 * runtime. It is re-validated here against the shared schema instead of being
 * cast, so a hand-edited or legacy row degrades to "no working hours shown"
 * rather than crashing a customer-facing profile.
 */
function toWorkingHours(value: unknown) {
  const parsed = workingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function professionalNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The selected professional profile was not found.',
  });
}

function firstNameOnly(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export { professionalMarketplaceProfileSchema };

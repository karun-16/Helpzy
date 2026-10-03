import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADMIN_AUDIT_ACTIONS,
  API_ERROR_CODES,
  PROFESSIONAL_VERIFICATION_STATUSES,
  SERVICE_MODERATION_STATUSES,
  type ServiceModerationStatus,
} from '@helpzy/types';
import type { SetServiceStatusDto } from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Admin moderation of individual service listings.
 *
 * A listing is never deleted here. `Service.ownerId` cascades on delete and
 * bookings reference the service, so removing a row would destroy booking
 * history; withdrawing one only flips `isActive`, which the public discovery
 * query already filters on, so the listing disappears from the marketplace while
 * every existing booking against it keeps working and is still paid out.
 */
@Injectable()
export class AdminServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every listing, withdrawn ones included, so an admin can find a service they
   * hid earlier and restore it.
   */
  async list(options: { search?: string; categoryId?: string; onlyInactive?: boolean } = {}) {
    const search = options.search?.trim().slice(0, 80);

    const services = await this.prisma.service.findMany({
      where: {
        ...(options.onlyInactive ? { isActive: false } : {}),
        ...(options.categoryId ? { categoryId: options.categoryId } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' as const } },
                { summary: { contains: search, mode: 'insensitive' as const } },
                { owner: { fullName: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        category: { select: { id: true, name: true } },
        owner: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            status: true,
            professionalProfile: { select: { verification: true } },
          },
        },
        _count: { select: { bookings: true } },
      },
    });

    return services.map(toAdminService);
  }

  /**
   * Withdraws or restores a listing.
   *
   * The reason is mandatory and is shown to the professional, because a listing
   * that silently vanished from search would look like a bug and generate
   * support traffic rather than a fixable complaint.
   */
  async setStatus(actorUserId: string, serviceId: string, input: SetServiceStatusDto) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        title: true,
        isActive: true,
        moderationStatus: true,
        ownerId: true,
        moderationNote: true,
      },
    });

    if (!service) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That service listing was not found.',
      });
    }

    /*
     * The decision *is* the moderation state: activating a listing
     * approves it, withdrawing it rejects it. A decision is a no-op
     * only when it would leave the listing exactly where it already
     * is - the same moderation state *and* the same visibility.
     * Judging on both is what lets an admin reject a listing that is
     * still awaiting review even though both read inactive, and
     * re-activate an approved listing the professional hid.
     */
    const decidedStatus = input.isActive
      ? SERVICE_MODERATION_STATUSES.APPROVED
      : SERVICE_MODERATION_STATUSES.REJECTED;
    const alreadyInThatState =
      service.moderationStatus === decidedStatus && service.isActive === input.isActive;
    if (alreadyInThatState) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: input.isActive
          ? 'That listing is already active.'
          : 'That listing is already withdrawn.',
      });
    }

    await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        isActive: input.isActive,
        moderationStatus: decidedStatus,
        // The note belongs to the withdrawn state only; restoring clears it so
        // a live listing never carries a stale complaint on its record.
        moderationNote: input.isActive ? null : input.reason,
        moderatedAt: new Date(),
      },
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.SERVICE_MODERATED,
      entityType: 'SERVICE',
      entityId: serviceId,
      metadata: {
        from: service.isActive,
        to: input.isActive,
        moderationStatus: decidedStatus,
        reason: input.reason,
        title: service.title,
        ownerId: service.ownerId,
        previousNote: service.moderationNote ?? null,
      },
    });

    // Re-read rather than echoing the write: the response is the full listing the
    // admin's table renders, so it must carry the same shape as the list.
    return this.findOne(serviceId);
  }

  /** One listing in the same shape the list returns, for the status response. */
  private async findOne(serviceId: string) {
    const found = await this.prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        category: { select: { id: true, name: true } },
        owner: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            status: true,
            professionalProfile: { select: { verification: true } },
          },
        },
        _count: { select: { bookings: true } },
      },
    });

    if (!found) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That service listing was not found.',
      });
    }

    return toAdminService(found);
  }
}

/**
 * One listing row in the shape both the list and the status response use.
 *
 * Prisma's `Decimal` and `DateTime` are converted here rather than in each
 * caller so the two endpoints can never drift into returning different shapes
 * for the same listing.
 */
function toAdminService(service: {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  basePrice: { toNumber: () => number };
  currency: string;
  durationMinutes: number;
  isActive: boolean;
  moderationStatus: string;
  moderationNote: string | null;
  moderatedAt: Date | null;
  ratingCount: number;
  averageRating: { toNumber: () => number };
  createdAt: Date;
  category: { id: string; name: string };
  owner: {
    id: string;
    fullName: string;
    phone: string | null;
    status: string;
    professionalProfile: { verification: string } | null;
  };
  _count: { bookings: number };
}) {
  return {
    id: service.id,
    title: service.title,
    slug: service.slug,
    summary: service.summary,
    priceAmount: service.basePrice.toNumber(),
    currency: service.currency,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
    moderationStatus: service.moderationStatus as ServiceModerationStatus,
    moderationNote: service.moderationNote ?? null,
    moderatedAt: service.moderatedAt?.toISOString() ?? null,
    bookingCount: service._count.bookings,
    ratingCount: service.ratingCount,
    averageRating: service.averageRating.toNumber(),
    createdAt: service.createdAt.toISOString(),
    category: { id: service.category.id, name: service.category.name },
    owner: {
      id: service.owner.id,
      fullName: service.owner.fullName,
      phone: service.owner.phone ?? '',
      status: service.owner.status,
      // A professional who never filed verification paperwork reports as
      // unreviewed rather than as a value the admin has not seen.
      verification:
        service.owner.professionalProfile?.verification ??
        PROFESSIONAL_VERIFICATION_STATUSES.UNVERIFIED,
    },
  };
}

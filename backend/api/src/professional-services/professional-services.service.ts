import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES } from '@helpzy/types';
import type {
  CreateProfessionalServiceDto,
  ProfessionalCategoryOptionDto,
  ProfessionalServiceRecordDto,
  UpdateProfessionalServiceDto,
} from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';

/**
 * The services a professional offers.
 *
 * Ownership is always the session user's own profile, resolved from the session
 * and never from the request body. A professional cannot edit, hide or delete
 * somebody else's service, and cannot change a service's category or owner.
 *
 * Deleting is refused once a booking exists for the service. Hiding
 * (`isActive: false`) is the reversible option, and past bookings must keep
 * pointing at something real so their history stays intact.
 */
@Injectable()
export class ProfessionalServicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The categories a professional may publish under.
   *
   * Returns only active categories, so a professional cannot file a service under
   * a retired category that the create path would then refuse anyway.
   */
  async listCategories(): Promise<ProfessionalCategoryOptionDto[]> {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, description: true },
    });
    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
    }));
  }

  async list(userId: string): Promise<ProfessionalServiceRecordDto[]> {
    const profile = await this.profileOrNull(userId);
    if (!profile) return [];

    const services = await this.prisma.service.findMany({
      where: { ownerId: userId },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
      include: {
        category: { select: { id: true, slug: true, name: true, isActive: true } },
        _count: { select: { bookings: true } },
      },
    });

    return services.map((service) => this.toRecord(service));
  }

  async create(
    userId: string,
    input: CreateProfessionalServiceDto,
  ): Promise<ProfessionalServiceRecordDto> {
    await this.profileOrThrow(userId);

    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: input.categoryId },
      select: { id: true, name: true, isActive: true },
    });
    if (!category || !category.isActive) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That service category is not available.',
      });
    }

    // The slug is derived server-side from the title so two services with the
    // same title cannot collide on a globally unique column, and a title change
    // cannot silently break an existing link.
    const base = slugify(input.title);
    const slug = await this.uniqueSlug(base);

    const service = await this.prisma.service.create({
      data: {
        ownerId: userId,
        categoryId: input.categoryId,
        title: input.title,
        slug,
        summary: input.summary ?? null,
        description: input.description,
        basePrice: input.priceAmount,
        currency: input.currency.toUpperCase(),
        durationMinutes: input.durationMinutes,
      },
      include: {
        category: { select: { id: true, slug: true, name: true, isActive: true } },
        _count: { select: { bookings: true } },
      },
    });

    return this.toRecord(service);
  }

  async update(
    userId: string,
    serviceId: string,
    input: UpdateProfessionalServiceDto,
  ): Promise<ProfessionalServiceRecordDto> {
    await this.profileOrThrow(userId);

    // Scoping by owner is the ownership guarantee; the count check is just to
    // return a clear message for the common "I have history here" case.
    const existing = await this.prisma.service.findFirst({
      where: { id: serviceId, ownerId: userId },
      select: { id: true, _count: { select: { bookings: true } } },
    });
    if (!existing) throw serviceNotFound();

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceAmount !== undefined ? { basePrice: input.priceAmount } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: {
        category: { select: { id: true, slug: true, name: true, isActive: true } },
        _count: { select: { bookings: true } },
      },
    });

    return this.toRecord(updated);
  }

  /**
   * Removes a service that has never been booked.
   *
   * Refused once history exists, because a booking row pointing at a deleted
   * service would leave a customer's past job unnameable. `isActive: false` is
   * the way to withdraw a service that does have history.
   */
  async remove(userId: string, serviceId: string): Promise<{ deleted: boolean }> {
    await this.profileOrThrow(userId);

    const existing = await this.prisma.service.findFirst({
      where: { id: serviceId, ownerId: userId },
      select: { id: true, _count: { select: { bookings: true } } },
    });
    if (!existing) throw serviceNotFound();

    if (existing._count.bookings > 0) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message:
          'This service has booking history and cannot be deleted. Hide it instead to stop new bookings.',
      });
    }

    await this.prisma.service.delete({ where: { id: serviceId } });
    return { deleted: true };
  }

  private async profileOrNull(userId: string) {
    return this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  private async profileOrThrow(userId: string) {
    const profile = await this.profileOrNull(userId);
    if (!profile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'Your professional profile could not be found.',
      });
    }
    return profile;
  }

  /** Appends a counter until the slug is free, rather than failing on a clash. */
  private async uniqueSlug(base: string): Promise<string> {
    for (let suffix = 1; suffix <= 50; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      const clash = await this.prisma.service.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new ConflictException({
      code: API_ERROR_CODES.CONFLICT,
      message: 'Could not derive a unique address for this service title.',
    });
  }

  private toRecord(service: {
    id: string;
    title: string;
    slug: string;
    summary: string | null;
    description: string;
    basePrice: { toNumber: () => number };
    currency: string;
    durationMinutes: number;
    isActive: boolean;
    category: { id: string; slug: string; name: string };
    _count: { bookings: number };
  }): ProfessionalServiceRecordDto {
    return {
      id: service.id,
      title: service.title,
      slug: service.slug,
      summary: service.summary,
      description: service.description,
      priceAmount: service.basePrice.toNumber(),
      currency: service.currency,
      durationMinutes: service.durationMinutes,
      isActive: service.isActive,
      category: {
        id: service.category.id,
        slug: service.category.slug,
        name: service.category.name,
      },
      // Real bookings only, so a professional cannot advertise phantom work.
      bookingCount: service._count.bookings,
    };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function serviceNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested service was not found.',
  });
}

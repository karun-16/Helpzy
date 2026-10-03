import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ADMIN_AUDIT_ACTIONS, API_ERROR_CODES } from '@helpzy/types';
import type {
  CreateCategoryDto,
  SetCategoryStatusDto,
  UpdateCategoryDto,
} from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Admin management of the marketplace's service categories.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing is deleted.** A category is referenced by services with
 *    `onDelete: Restrict`, so removing one would either fail or take live
 *    listings with it. Deactivating is the reversible equivalent, and the public
 *    discovery query already filters on `category.isActive`, so deactivating
 *    withdraws the category and its services without touching either row.
 * 2. **Services are never reassigned or edited.** Moderating a category only
 *    changes its availability; an existing booking keeps pointing at the service
 *    it was made against.
 */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every category, active or not, so an admin can find something that is
   * already hidden and switch it back on.
   */
  async list(options: { search?: string; includeInactive?: boolean } = {}) {
    const search = options.search?.trim().slice(0, 80);
    const categories = await this.prisma.serviceCategory.findMany({
      where: {
        // The admin list shows everything by default; the public list is what
        // filters, not this query.
        ...(options.includeInactive === false ? { isActive: true } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { services: true } } },
    });

    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      isActive: category.isActive,
      sortOrder: category.sortOrder,
      serviceCount: category._count.services,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    }));
  }

  async create(actorUserId: string, input: CreateCategoryDto) {
    await this.assertNameAvailable(input.name);

    const created = await this.prisma.serviceCategory.create({
      data: {
        name: input.name,
        // Derived here rather than accepted from the client, so a category's
        // address always follows its name.
        slug: await this.uniqueSlug(slugify(input.name)),
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: true,
      },
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.CATEGORY_CREATED,
      entityType: 'SERVICE_CATEGORY',
      entityId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });

    return {
      id: created.id,
      slug: created.slug,
      name: created.name,
      description: created.description,
      isActive: created.isActive,
      sortOrder: created.sortOrder,
      serviceCount: 0,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async update(actorUserId: string, categoryId: string, input: UpdateCategoryDto) {
    const existing = await this.requireCategory(categoryId);

    // Reusing another category's name would make the marketplace ambiguous, and
    // is rejected even when the other row is inactive.
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(input.name);
    }

    const updated = await this.prisma.serviceCategory.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.CATEGORY_UPDATED,
      entityType: 'SERVICE_CATEGORY',
      entityId: categoryId,
      metadata: {
        before: {
          name: existing.name,
          description: existing.description,
          sortOrder: existing.sortOrder,
        },
        after: {
          name: updated.name,
          description: updated.description,
          sortOrder: updated.sortOrder,
        },
      },
    });

    const serviceCount = await this.prisma.service.count({ where: { categoryId } });
    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      serviceCount,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Switches a category on or off.
   *
   * Deactivating hides the category and every service filed under it from public
   * discovery - the existing marketplace rules already filter on both. Nothing is
   * deleted or reassigned, so reactivating restores every listing exactly as it
   * was.
   */
  async setStatus(actorUserId: string, categoryId: string, input: SetCategoryStatusDto) {
    const existing = await this.requireCategory(categoryId);

    if (input.isActive === existing.isActive) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: input.isActive
          ? 'That category is already active.'
          : 'That category is already inactive.',
      });
    }

    const updated = await this.prisma.serviceCategory.update({
      where: { id: categoryId },
      data: { isActive: input.isActive },
    });

    const affectedServices = await this.prisma.service.count({ where: { categoryId } });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.CATEGORY_STATUS_CHANGED,
      entityType: 'SERVICE_CATEGORY',
      entityId: categoryId,
      metadata: {
        from: existing.isActive,
        to: input.isActive,
        name: existing.name,
        ...(input.reason ? { reason: input.reason } : {}),
        // Recorded so the admin can see the blast radius of the change later.
        affectedServices,
      },
    });

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      serviceCount: affectedServices,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        sortOrder: true,
      },
    });
    if (!category) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That service category was not found.',
      });
    }
    return category;
  }

  /**
   * Category names are unique case-insensitively: the public UI groups services
   * by name, so "Home Services" and "home services" would look like a bug to a
   * customer and split a professional's listings across two headings.
   */
  private async assertNameAvailable(name: string): Promise<void> {
    const clash = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'A category with that name already exists.',
      });
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let suffix = 1; suffix <= 50; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      const clash = await this.prisma.serviceCategory.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new ConflictException({
      code: API_ERROR_CODES.CONFLICT,
      message: 'Could not derive a unique address for this category name.',
    });
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'category'
  );
}

import { Injectable, Logger } from '@nestjs/common';
import { ADMIN_AUDIT_ACTIONS, type AdminAuditAction } from '@helpzy/types';
import type { AuditEntityType, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export interface AuditInput {
  actorUserId: string;
  action: AdminAuditAction | string;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only record of privileged actions.
 *
 * Like notifications, audit writes never throw: losing an audit row must not
 * fail the administrative action that produced it, but the failure is logged.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: AuditInput,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not write an audit log for ${input.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Newest first, for the admin audit screen. */
  async list(options: { entityType?: AuditEntityType; limit?: number } = {}) {
    const entries = await this.prisma.auditLog.findMany({
      where: options.entityType ? { entityType: options.entityType } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 100, 500),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      actorName: entry.actor.fullName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}

export { ADMIN_AUDIT_ACTIONS };

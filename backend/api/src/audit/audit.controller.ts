import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ADMIN_AUDIT_ACTIONS, API_ERROR_CODES, ROLES } from '@helpzy/types';
import type { AuditEntityType } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';

/**
 * Every value of the Prisma `AuditEntityType` enum.
 *
 * Exported so `audit.controller.spec.ts` can assert it stays in step with the
 * schema: an entity type that a service audits but this list omits can be written
 * to the table and still be unreachable through the admin audit filter.
 */
export const AUDIT_ENTITY_TYPES: AuditEntityType[] = [
  'USER',
  'PROFESSIONAL_PROFILE',
  'SERVICE',
  'SERVICE_CATEGORY',
  'BOOKING',
  'PAYMENT',
  'REVIEW',
  'NOTIFICATION',
  'REPORT',
  'DISPUTE',
  'VERIFICATION_DOCUMENT',
  'PLATFORM_SETTING',
];

@Controller('admin/audit')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('entityType') entityType: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.audit.list({
      ...(parseEntityType(entityType) ? { entityType: parseEntityType(entityType)! } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get('actions')
  actions() {
    return { actions: ADMIN_AUDIT_ACTIONS };
  }
}

function parseEntityType(value: string | undefined): AuditEntityType | undefined {
  if (!value) return undefined;
  if (!AUDIT_ENTITY_TYPES.includes(value as AuditEntityType)) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'That audit entity type is not recognised.',
    });
  }
  return value as AuditEntityType;
}

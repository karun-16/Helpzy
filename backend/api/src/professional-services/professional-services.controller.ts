import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import {
  createProfessionalServiceSchema,
  updateProfessionalServiceSchema,
} from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProfessionalServicesService } from './professional-services.service';

/**
 * The professional's own service catalogue.
 *
 * Every route is scoped to the session user: the request never names a service
 * owner, so a professional cannot reach another professional's catalogue.
 */
@Controller('professional/services')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalServicesController {
  constructor(private readonly services: ProfessionalServicesService) {}

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.services.list(request.user!.id);
  }

  @Get('categories')
  listCategories() {
    return this.services.listCategories();
  }

  @Post()
  create(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.services.create(
      request.user!.id,
      parseOrThrow(createProfessionalServiceSchema, body),
    );
  }

  @Patch(':serviceId')
  update(
    @Req() request: RequestWithUser,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ) {
    return this.services.update(
      request.user!.id,
      serviceId,
      parseOrThrow(updateProfessionalServiceSchema, body),
    );
  }

  @Delete(':serviceId')
  remove(@Req() request: RequestWithUser, @Param('serviceId') serviceId: string) {
    return this.services.remove(request.user!.id, serviceId);
  }
}

function parseOrThrow<T>(schema: ZodLike, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as T;
  throw new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Please check the details and try again.',
    details: parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      messages: [issue.message],
    })),
  });
}

/** The two Zod schemas above share this shape; naming it keeps the helper honest. */
interface ZodLike {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: unknown }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

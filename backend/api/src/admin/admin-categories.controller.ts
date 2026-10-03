import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import {
  createCategorySchema,
  setCategoryStatusSchema,
  updateCategorySchema,
} from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminCategoriesService } from './admin-categories.service';

/**
 * Admin-only category management, mounted separately from `AdminController` so
 * category moderation keeps its own service and its own tests.
 */
@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.categories.list({
      ...(search ? { search } : {}),
      // The default already includes inactive rows, so this is opt-out.
      ...(includeInactive === 'false' ? { includeInactive: false } : {}),
    });
  }

  @Post()
  create(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.categories.create(request.user!.id, parseOrThrow(createCategorySchema, body));
  }

  @Patch(':categoryId')
  update(
    @Req() request: RequestWithUser,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.categories.update(
      request.user!.id,
      categoryId,
      parseOrThrow(updateCategorySchema, body),
    );
  }

  @Patch(':categoryId/status')
  setStatus(
    @Req() request: RequestWithUser,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.categories.setStatus(
      request.user!.id,
      categoryId,
      parseOrThrow(setCategoryStatusSchema, body),
    );
  }
}

function parseOrThrow<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: unknown }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as T;
  throw new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Please check the details and try again.',
    details: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
      field: issue.path.join('.') || '(root)',
      messages: [issue.message],
    })),
  });
}

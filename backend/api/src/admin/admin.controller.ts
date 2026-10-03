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
import { API_ERROR_CODES, ROLES, USER_STATUSES } from '@helpzy/types';
import { adminVerificationDecisionSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('summary')
  summary() {
    return this.admin.dashboardSummary();
  }

  @Get('users')
  listUsers(
    @Query('role') role: string | undefined,
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Query('categoryId') categoryId: string | undefined,
  ) {
    return this.admin.listUsers({
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
  }

  @Get('professionals/:userId')
  getProfessional(@Param('userId') userId: string) {
    return this.admin.getProfessionalDetail(userId);
  }

  @Get('bookings')
  listBookings(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.listBookings({ search, status, from, to });
  }

  @Patch('users/:userId/status')
  setUserStatus(
    @Req() request: RequestWithUser,
    @Param('userId') userId: string,
    @Body() body: { status?: unknown },
  ) {
    const status = body?.status;
    if (typeof status !== 'string' || !Object.values(USER_STATUSES).includes(status as never)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `Choose one of: ${Object.values(USER_STATUSES).join(', ')}.`,
      });
    }
    return this.admin.setUserStatus(request.user!.id, userId, status as never);
  }

  @Get('verification-requests')
  listVerificationRequests() {
    return this.admin.listVerificationRequests();
  }

  @Post('verification-requests/:profileId/decision')
  decideVerification(
    @Req() request: RequestWithUser,
    @Param('profileId') profileId: string,
    @Body() body: unknown,
  ) {
    const parsed = adminVerificationDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Please check the decision and try again.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }
    return this.admin.decideVerification(
      request.user!.id,
      profileId,
      parsed.data.decision,
      parsed.data.note,
    );
  }
}

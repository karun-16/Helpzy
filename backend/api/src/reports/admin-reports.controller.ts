import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { resolveReportSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';

/** Admin triage of filed reports. */
@Controller('admin/reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('reason') reason?: string,
    @Query('search') search?: string,
  ) {
    return this.reports.list({
      ...(status ? { status } : {}),
      ...(reason ? { reason } : {}),
      ...(search ? { search } : {}),
    });
  }

  @Get(':reportId')
  get(@Param('reportId') reportId: string) {
    return this.reports.get(reportId);
  }

  @Patch(':reportId/review')
  startReview(@Param('reportId') reportId: string) {
    return this.reports.startReview(reportId);
  }

  @Patch(':reportId/resolve')
  resolve(
    @Req() request: RequestWithUser,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ) {
    return this.reports.resolve(request.user!.id, reportId, resolveReportSchema.parse(body));
  }
}

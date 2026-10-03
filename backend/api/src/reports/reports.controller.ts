import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { createReportSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { ReportsService } from './reports.service';

/**
 * Filing a report.
 *
 * Available to any signed-in user, because a customer and a professional can both
 * be on the wrong end of this. The route is namespaced under `reports` rather
 * than under a role so neither side has to reach into the other's space, and the
 * target is resolved server-side so the client cannot report an arbitrary id.
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  file(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.reports.file(request.user!.id, createReportSchema.parse(body));
  }
}

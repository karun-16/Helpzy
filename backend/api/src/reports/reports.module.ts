import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
  // Exported so the admin console can triage the same service instance and the
  // same notification path the reporting side uses.
  exports: [ReportsService],
})
export class ReportsModule {}

import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AdminDisputesController,
  DisputeMessagesController,
  DisputesController,
} from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule],
  controllers: [DisputesController, DisputeMessagesController, AdminDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}

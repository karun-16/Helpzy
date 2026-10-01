import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AdminReviewsController,
  CustomerReviewsController,
  ProfessionalReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule, NotificationsModule, AuditModule],
  controllers: [CustomerReviewsController, ProfessionalReviewsController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}

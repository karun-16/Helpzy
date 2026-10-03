import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminController } from './admin.controller';
import { AdminServicesController } from './admin-services.controller';
import { AdminServicesService } from './admin-services.service';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule],
  controllers: [
    AdminController,
    AdminBookingsController,
    AdminCategoriesController,
    AdminServicesController,
  ],
  providers: [AdminService, AdminBookingsService, AdminCategoriesService, AdminServicesService],
})
export class AdminModule {}

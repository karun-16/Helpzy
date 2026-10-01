import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingLifecycleModule } from '../bookings/booking-lifecycle.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerBookingsController } from './customer-bookings.controller';
import { CustomerBookingsService } from './customer-bookings.service';

@Module({
  imports: [AuthModule, BookingLifecycleModule, NotificationsModule],
  controllers: [CustomerBookingsController],
  providers: [CustomerBookingsService],
})
export class CustomerBookingsModule {}

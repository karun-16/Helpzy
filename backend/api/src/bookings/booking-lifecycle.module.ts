import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { BookingLifecycleService } from './booking-lifecycle.service';

/**
 * Shared booking status machine.
 *
 * Exported so the professional and customer booking feature modules can both
 * apply transitions without duplicating the ordering and ownership rules.
 */
@Module({
  imports: [NotificationsModule],
  providers: [BookingLifecycleService],
  exports: [BookingLifecycleService],
})
export class BookingLifecycleModule {}

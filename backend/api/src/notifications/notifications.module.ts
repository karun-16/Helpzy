import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The notifications feature module.
 *
 * `AuthModule` is imported so the controller's `AuthGuard` can resolve its
 * `AuthService`; the service itself is exported for the booking lifecycle to
 * emit notifications from inside its own transaction.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

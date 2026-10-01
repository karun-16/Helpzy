import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingLifecycleModule } from '../bookings/booking-lifecycle.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerPaymentsController, ProfessionalPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, BookingLifecycleModule, NotificationsModule],
  controllers: [CustomerPaymentsController, ProfessionalPaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}

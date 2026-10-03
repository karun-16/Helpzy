import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingLifecycleModule } from '../bookings/booking-lifecycle.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  CustomerPaymentsController,
  PaymentWebhookController,
  ProfessionalPaymentsController,
} from './payments.controller';
import { SandboxPaymentGateway } from './payment-gateway.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, BookingLifecycleModule, NotificationsModule],
  controllers: [
    CustomerPaymentsController,
    ProfessionalPaymentsController,
    PaymentWebhookController,
  ],
  providers: [
    PaymentsService,
    // Bound as a concrete token so the service's `PaymentGateway` dependency
    // resolves to the sandbox provider. Swapping in a real vendor means
    // providing a different `PaymentGateway` here and nothing else.
    SandboxPaymentGateway,
  ],
})
export class PaymentsModule {}

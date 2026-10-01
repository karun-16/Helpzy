import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { ConfigModule } from './config/config.module';
import { CustomerAccountModule } from './customer-account/customer-account.module';
import { CustomerDiscoveryModule } from './customer-discovery/customer-discovery.module';
import { CustomerBookingsModule } from './customer-bookings/customer-bookings.module';
import { ProfessionalBookingsModule } from './professional-bookings/professional-bookings.module';
import { ProfessionalProfileModule } from './professional-profile/professional-profile.module';
import { ProfessionalServicesModule } from './professional-services/professional-services.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AuditModule } from './audit/audit.module';
import { BookingChatModule } from './booking-chat/booking-chat.module';
import { LocationModule } from './location/location.module';
import { AdminModule } from './admin/admin.module';
/**
 * Composition root. Feature modules are mounted here as phases are delivered;
 * the cross-cutting filter and interceptor are registered globally so no module
 * can opt out of the response and error contracts.
 *
 * The request id middleware is applied in `bootstrap.ts` with `app.use()` rather
 * than through `MiddlewareConsumer.forRoutes()`: a consumer-scoped middleware is
 * bound to the Nest router, so requests that match no route at all (for example
 * `/typo` outside the versioned prefix) would never be assigned a request id and
 * could not be traced in the logs.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    MediaModule,
    NotificationsModule,
    AuditModule,
    CustomerDiscoveryModule,
    CustomerBookingsModule,
    CustomerAccountModule,
    ProfessionalBookingsModule,
    ProfessionalProfileModule,
    ProfessionalServicesModule,
    PaymentsModule,
    ReviewsModule,
    BookingChatModule,
    LocationModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}

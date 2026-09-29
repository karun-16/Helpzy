import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { ConfigModule } from './config/config.module';
import { CustomerDiscoveryModule } from './customer-discovery/customer-discovery.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

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
  imports: [ConfigModule, DatabaseModule, HealthModule, AuthModule, CustomerDiscoveryModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';

import { LocationCatalogModule } from '../location-catalog/location-catalog.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OptionalAuthGuard } from './optional-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [LocationCatalogModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard, OptionalAuthGuard],
  exports: [AuthService, AuthGuard, RolesGuard, OptionalAuthGuard],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminSettingsController } from './admin-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { PublicSettingsController } from './public-settings.controller';

/**
 * Platform settings.
 *
 * Global because the services that enforce these rules are scattered across the
 * booking, service and payment modules. Making it global lets them inject
 * `PlatformSettingsService` without every one of those modules having to import
 * this one, which would put a settings dependency into modules that otherwise have
 * no reason to know settings exist.
 *
 * It exports the service only. Both controllers are private to this module, so
 * there is exactly one route to read or write settings and no way to register a
 * second copy by accident.
 */
@Global()
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminSettingsController, PublicSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}

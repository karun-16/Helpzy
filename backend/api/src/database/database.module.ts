import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Database access.
 *
 * `PrismaService` is provided globally so feature modules inject it directly
 * instead of re-importing this module everywhere. The client is created from
 * `DATABASE_URL`, validated by the configuration module at startup.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}

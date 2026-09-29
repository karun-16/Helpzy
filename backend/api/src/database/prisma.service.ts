import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';

/**
 * Prisma connection lifecycle for the API process.
 *
 * Startup policy:
 *  - production: a failed connection is fatal. A process that cannot reach its
 *    database must not accept traffic.
 *  - development / test: the process starts anyway and logs the failure, so a
 *    missing local database does not block the rest of the work. `GET /api/v1/health`
 *    then reports the database as DOWN, which is the signal to act on.
 *
 * The connection is opened once on module init and closed on shutdown, so
 * `$disconnect` runs exactly once and a container stop does not leak sockets.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfigRef) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('Database connection established');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database connection failed: ${reason}`);

      if (this.config.isProduction) {
        throw error;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}

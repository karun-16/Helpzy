import { Inject, Injectable } from '@nestjs/common';
import {
  SERVICE_STATUSES,
  type HealthCheckResult,
  type HealthResponse,
  type ServiceStatus,
} from '@helpzy/types';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';

const SERVICE_NAME = 'helpzy-api';

/** Dependency identifiers, stable so a monitor can alert on a specific one. */
const CHECK_PROCESS = 'process';
const CHECK_DATABASE = 'database';

/**
 * Builds the health payload.
 *
 * The endpoint answers even when downstream systems are unavailable: a failing
 * dependency is reported through `checks` with an overall `DEGRADED` or `DOWN`
 * status rather than by failing the request, so an orchestrator can tell
 * "process is dead" apart from "process is alive but a dependency is not".
 *
 * The database probe is a real round trip (`SELECT 1`), not a flag, so a pooled
 * connection that PostgreSQL has closed is detected.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
    private readonly prisma: PrismaService,
  ) {}

  async check(): Promise<HealthResponse> {
    const checks: HealthCheckResult[] = [this.checkProcess(), await this.checkDatabase()];

    return {
      status: overallStatus(checks),
      service: SERVICE_NAME,
      version: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private checkProcess(): HealthCheckResult {
    const startedAt = process.hrtime.bigint();
    return {
      name: CHECK_PROCESS,
      status: SERVICE_STATUSES.UP,
      latencyMs: elapsedMs(startedAt),
    };
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    const startedAt = process.hrtime.bigint();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        name: CHECK_DATABASE,
        status: SERVICE_STATUSES.UP,
        latencyMs: elapsedMs(startedAt),
      };
    } catch (error) {
      // The message is for operators reading `/api/v1/health`; it never contains
      // credentials because the client is configured with a redacted URL.
      return {
        name: CHECK_DATABASE,
        status: SERVICE_STATUSES.DOWN,
        latencyMs: elapsedMs(startedAt),
        message: error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function overallStatus(checks: HealthCheckResult[]): ServiceStatus {
  if (checks.some((check) => check.status === SERVICE_STATUSES.DOWN)) return SERVICE_STATUSES.DOWN;
  if (checks.some((check) => check.status === SERVICE_STATUSES.DEGRADED)) {
    return SERVICE_STATUSES.DEGRADED;
  }
  return SERVICE_STATUSES.UP;
}

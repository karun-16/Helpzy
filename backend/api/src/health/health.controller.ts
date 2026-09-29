import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { OPERATIONAL_ROUTES } from '@helpzy/config';
import type { HealthResponse } from '@helpzy/types';

import { HealthService } from './health.service';

/**
 * Operational endpoint, served from the root (`GET /health`) and excluded from
 * the versioned API prefix so that the path stays stable as the API is
 * versioned. Load balancers, uptime probes and the in-app status screen all
 * rely on it.
 */
@Controller(OPERATIONAL_ROUTES.health)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}

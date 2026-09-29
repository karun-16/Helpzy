import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { API_ROUTES } from '@helpzy/config';
import type { HealthResponse } from '@helpzy/types';

import { HealthService } from './health.service';

/**
 * Health is part of the versioned API contract (`GET /api/v1/health`) and is
 * consumed by both uptime probes and the in-app status screen.
 */
@Controller(API_ROUTES.health)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}

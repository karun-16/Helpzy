import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { OPERATIONAL_ROUTES } from '@helpzy/config';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfigRef } from './config/app-config.token';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfigRef>(APP_CONFIG);
  const logger = new Logger('Bootstrap');

  configureApp(app, config);

  await app.listen(config.port, config.host);

  logger.log(`HELPZY API ready on http://${config.host}:${config.port}`);
  logger.log(`Environment: ${config.nodeEnv}`);
  logger.log(`Health: GET /${OPERATIONAL_ROUTES.health.replace(/^\//, '')}`);
  logger.log(`Versioned API prefix: /${config.globalPrefix}`);
}

void bootstrap();

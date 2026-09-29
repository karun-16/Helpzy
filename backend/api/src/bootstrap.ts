import { RequestMethod, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { OPERATIONAL_ROUTES } from '@helpzy/config';

import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AppConfig } from './config/env';

export const HEALTH_EXCLUDE = {
  path: OPERATIONAL_ROUTES.health,
  method: RequestMethod.GET,
} as const;

/**
 * Applies the HTTP contract shared by every entry point (dev server, tests and
 * production).
 *
 * Keeping this in one function means a route cannot behave differently in a
 * test than it does in a real deployment, and guarantees that CORS, prefixes and
 * pipes can never be forgotten in one of the two paths.
 */
export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  // Registered as plain Express middleware so that *every* request is traced,
  // including the ones that never reach a controller. Must stay first.
  app.use(requestIdMiddleware);

  // Security headers. Runs after the request id (so nothing can be logged
  // untraced) and before CORS, so CORS headers are added last and are never
  // removed by a header policy. Helmet's defaults are kept; only the HTML
  // Content-Security-Policy is disabled because this API serves JSON and
  // credentials over fetch, never documents - a CSP here would protect nothing.
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // Operational routes stay outside the versioned prefix so their path is
  // stable; every product route is served under `API_GLOBAL_PREFIX`.
  app.setGlobalPrefix(config.globalPrefix, { exclude: [HEALTH_EXCLUDE] });

  app.enableCors({
    // An explicit allow-list only. `API_CORS_ORIGINS` cannot contain a wildcard
    // (see `parseCsv`), because reflecting any origin on a credentialed API would
    // let any website on the internet make authenticated calls to it.
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  return app;
}

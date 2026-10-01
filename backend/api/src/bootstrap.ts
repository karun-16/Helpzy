import type { INestApplication } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from 'helmet';
import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AppConfig } from './config/env';

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

  // Every API route, including health, is served under `API_GLOBAL_PREFIX`.
  app.setGlobalPrefix(config.globalPrefix);

  app.enableCors({
    // An explicit allow-list only. `API_CORS_ORIGINS` cannot contain a wildcard
    // (see `parseCsv`), because reflecting any origin on a credentialed API would
    // let any website on the internet make authenticated calls to it.
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  raiseJsonBodyLimit(app, config);

  serveLocalMedia(app, config);

  return app;
}

/**
 * Raises the JSON body limit above Express's 100kb default.
 *
 * Profile photos are uploaded as base64 inside a JSON body, so the wire size is
 * roughly a third larger than the image itself. Without this, any image over
 * ~100kb was rejected by body-parser before a controller ever ran, and because
 * body-parser raises a plain error rather than an `HttpException`, the global
 * filter turned it into an opaque 500 - "Something went wrong on our side" -
 * for what is really an oversized upload.
 *
 * The limit is derived from `MEDIA_MAX_BYTES` so the two can never disagree: an
 * image the media layer would accept is an image that fits in the request body.
 * `urlencoded` is raised to match so a client cannot smuggle the same bytes
 * through a different content type.
 */
function raiseJsonBodyLimit(app: INestApplication, config: AppConfig): void {
  // base64 encodes 3 bytes as 4 characters, plus room for the JSON envelope
  // (`{"data":"...","contentType":"image/jpeg"}`).
  const limitBytes = Math.ceil((config.mediaMaxBytes * 4) / 3) + 64 * 1024;

  const expressApp = app as NestExpressApplication;
  if (typeof expressApp.useBodyParser === 'function') {
    expressApp.useBodyParser('json', { limit: limitBytes });
    expressApp.useBodyParser('urlencoded', { limit: limitBytes, extended: true });
    return;
  }

  // Fallback for an adapter without `useBodyParser`.
  app.use(express.json({ limit: limitBytes }));
  app.use(express.urlencoded({ extended: true, limit: limitBytes }));
}

/**
 * Serves the local development media store.
 *
 * This is the *only* place uploads are exposed. It is mounted outside
 * `API_GLOBAL_PREFIX` because the returned `publicUrl` has to work unchanged
 * whether the bytes end up on this server or in a vendor bucket later. Real
 * deployments should point the CDN at the provider instead; the local mount is
 * a development convenience, so it is skipped when the store is a real URL.
 */
function serveLocalMedia(app: INestApplication, config: AppConfig): void {
  const baseUrl = config.mediaPublicBaseUrl;
  if (!baseUrl.startsWith('/')) return;

  const root = resolve(config.mediaUploadDir);
  mkdirSync(root, { recursive: true });

  app.use(
    baseUrl,
    express.static(root, {
      // Uploads are immutable - every upload gets a fresh key - so a long cache
      // is safe, and `nosniff` stops a browser from re-interpreting bytes.
      maxAge: '7d',
      immutable: true,
      fallthrough: true,
      dotfiles: 'deny',
    }),
  );
}

import type { INestApplication } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import helmet from 'helmet';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
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

  serveWebClient(app, config);

  return app;
}

/** An Express request that also carries the untouched body bytes. */
type RequestWithRawBody = Request & { rawBody?: Buffer };

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

  /**
   * A gateway signature is computed over the raw request body, so the untouched
   * buffer is kept alongside the parsed body. Without this, re-serialising the
   * parsed JSON could change a byte or a key order and the signature would no
   * longer verify.
   */
  const verify = (request: Request, _response: Response, buffer: Buffer) => {
    (request as RequestWithRawBody).rawBody = Buffer.from(buffer);
  };

  const expressApp = app as NestExpressApplication;
  if (typeof expressApp.useBodyParser === 'function') {
    expressApp.useBodyParser('json', { limit: limitBytes, verify });
    expressApp.useBodyParser('urlencoded', { limit: limitBytes, extended: true });
    return;
  }

  // Fallback for an adapter without `useBodyParser`.
  app.use(express.json({ limit: limitBytes, verify }));
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

  /*
   * Helmet's default `Cross-Origin-Resource-Policy: same-origin` is correct for
   * the JSON API and wrong for this mount, so it is relaxed here and only here.
   *
   * A profile photo is rendered by an `<img>` that points at a different origin
   * than the page - the Expo web server on :8081, or a CDN in a real deployment.
   * An `<img>` without a `crossorigin` attribute is a *no-cors* request, which is
   * exactly the case CORP is checked on, so `same-origin` makes the browser
   * refuse to paint the photo. Nothing is ever logged and nothing ever errors in
   * the network panel: the bytes are served, the avatar's `onError` fires, and the
   * header falls back to initials - so an upload that genuinely saved read as one
   * that did not. `cross-origin` restores it.
   *
   * Scoped to this mount deliberately: the API keeps Helmet's default, and the
   * private verification documents are never mounted here at all, so identity
   * documents cannot be widened by this.
   */
  app.use(baseUrl, (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

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

/**
 * Serves the built Expo web export from the same process as the API.
 *
 * A single-service deployment needs one origin: the browser loads the app from
 * the API's own host and every `/api/v1/...` call is then same-origin, with no
 * CORS negotiation and nothing to keep in sync between two services.
 *
 * Registered before Nest's router, so anything this mount does not claim reaches
 * the controllers untouched. The API prefix and the media mount are excluded
 * explicitly - without that, the history fallback would answer an unknown
 * `/api/v1/...` path with `200` and the HTML shell, turning a real API 404 into
 * an unexplained "unexpected response" inside the client.
 */
function serveWebClient(app: INestApplication, config: AppConfig): void {
  /*
   * Production only, and deliberately so.
   *
   * This mount changes what an unprefixed path means: `/health` stops being an
   * API 404 and becomes a client-side route. That is exactly right for a
   * single-host deployment, and exactly wrong everywhere else - a developer
   * running `pnpm dev:api` should not see the API change behaviour because they
   * happened to run `pnpm build:web` at some point, and the test suite asserts
   * the API-only contract. Keying it to the environment keeps the web client a
   * deployment concern instead of a side effect of a build artefact.
   */
  if (!config.isProduction) return;

  // Configured away entirely: the mount is opt-out, not just opt-in.
  if (!config.webClientDir) return;

  const root = resolve(config.webClientDir);
  const shell = join(root, 'index.html');

  // A checkout that has never run the web build has no export to serve. Skipping
  // the mount entirely is honest: the API behaves exactly as it always has,
  // rather than answering `/` with a 404 that reads as a broken server.
  if (!existsSync(shell)) return;

  const apiPrefix = `/${config.globalPrefix.replace(/^\/+|\/+$/g, '')}`;
  const mediaPrefix = config.mediaPublicBaseUrl.startsWith('/')
    ? config.mediaPublicBaseUrl.replace(/\/+$/, '')
    : '';

  /*
   * Path-segment aware on purpose: a plain `startsWith` would also claim
   * `/mediaXyz`, and the prefix has to be matched up to a segment boundary so an
   * unknown API route stays an API route.
   */
  const isReserved = (path: string): boolean => {
    const matches = (prefix: string): boolean =>
      prefix !== '' && (path === prefix || path.startsWith(`${prefix}/`));
    return matches(apiPrefix) || matches(mediaPrefix);
  };

  const staticAssets: RequestHandler = express.static(root, {
    // `index: false` hands `/` to the fallback below, so the shell is always
    // served by one code path with one set of headers.
    index: false,
    /*
     * Deliberately short. Expo content-hashes the bundles under `_expo/static`,
     * but `index.html` and `favicon.ico` do not, and an immutable year-long
     * cache on those would pin users to a stale shell after a deploy.
     */
    maxAge: '1h',
    fallthrough: true,
    dotfiles: 'deny',
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isReserved(request.path)) return next();
    return staticAssets(request, response, next);
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (isReserved(request.path)) return next();

    // Expo is exported with `output: 'single'`, so every client-side route is
    // the same document and the router only ever runs in the browser.
    response.sendFile(shell, (error) => {
      if (error) next(error);
    });
  });
}

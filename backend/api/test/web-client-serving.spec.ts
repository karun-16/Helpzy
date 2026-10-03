import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { configureApp } from '../src/bootstrap';
import { envSchema, toAppConfig, type AppConfig } from '../src/config/env';

/**
 * Why this suite exists
 *
 * A single-service deployment serves the built Expo export from the API process,
 * which means the API owns a path it does not otherwise know about: a history
 * fallback that answers every non-API `GET` with the HTML shell.
 *
 * The fallback is the dangerous part. If it claims a path it should not, an
 * unknown `/api/v1/...` route stops being a 404 and becomes `200` with a page of
 * HTML, which the client reports as an unexplained "unexpected response" instead
 * of a missing route. So these tests pin both directions: the shell is served
 * where it should be, and the API, health, media and private-document routes are
 * never touched by it.
 */

@Controller('probe')
class ProbeController {
  @Get()
  probe(): { success: true; data: string } {
    return { success: true, data: 'ok' };
  }

  @Get('verification-documents/:id')
  document(): { success: true; data: string } {
    return { success: true, data: 'document-bytes' };
  }
}

/** Stands in for the real health controller, which sits directly on the prefix. */
@Controller('health')
class HealthProbeController {
  @Get()
  health(): { success: true; data: string } {
    return { success: true, data: 'UP' };
  }
}

@Module({ controllers: [ProbeController, HealthProbeController] })
class ProbeModule {}

const SHELL = '<!doctype html><title>HELPZY</title><div id="root"></div>';
const BUNDLE = 'console.log("helpzy");';

/** Minimal stand-in for the object `expo export` writes. */
function createWebExport(): string {
  const root = mkdtempSync(join(tmpdir(), 'hz-web-export-'));
  mkdirSync(join(root, '_expo', 'static', 'js'), { recursive: true });
  writeFileSync(join(root, 'index.html'), SHELL);
  writeFileSync(join(root, '_expo', 'static', 'js', 'entry-abc123.js'), BUNDLE);
  writeFileSync(join(root, 'favicon.ico'), 'icon-bytes');
  return root;
}

async function buildApp(config: AppConfig): Promise<{
  app: INestApplication;
  server: Parameters<typeof request>[0];
}> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  return { app, server: app.getHttpServer() };
}

function baseConfig(webClientDir: string): AppConfig {
  return {
    globalPrefix: 'api/v1',
    corsOrigins: ['http://localhost:8081'],
    mediaMaxBytes: 5 * 1024 * 1024,
    mediaPublicBaseUrl: '/media',
    mediaUploadDir: join(webClientDir, 'no-media'),
    privateMediaUploadDir: join(webClientDir, 'no-private-media'),
    webClientDir,
    isProduction: true,
    host: '0.0.0.0',
    port: 4000,
  } as AppConfig;
}

describe('web client hosting', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let webRoot: string;

  beforeAll(async () => {
    webRoot = createWebExport();
    ({ app, server } = await buildApp(baseConfig(webRoot)));
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the export shell at the root', async () => {
    const response = await request(server).get('/').expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<div id="root">');
  });

  it('serves a built asset with its own bytes', async () => {
    const response = await request(server).get('/_expo/static/js/entry-abc123.js').expect(200);

    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toBe(BUNDLE);
  });

  it('answers a client-side route with the shell instead of a 404', async () => {
    // Expo exports with `output: 'single'`, so this path only ever exists in the
    // browser. A deep link pasted into the address bar has to load the app.
    const response = await request(server).get('/customer/bookings/abc-123').expect(200);

    expect(response.text).toContain('<div id="root">');
  });

  it('does not let the history fallback swallow an unknown API route', async () => {
    /*
     * The regression this guards: the fallback answers everything that is not a
     * known static file, so without an explicit reservation an unknown API path
     * would come back `200 text/html` and the client would raise
     * INVALID_RESPONSE instead of reporting a missing route.
     */
    const response = await request(server).get('/api/v1/does-not-exist').expect(404);

    expect(response.headers['content-type']).toMatch(/json/);
    // The shell is the specific thing that must not appear here.
    expect(response.text).not.toContain('<div id="root">');
  });

  it('does not let the history fallback swallow the health route', async () => {
    const response = await request(server).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({ success: true, data: 'UP' });
  });

  it('does not let the history fallback swallow a private document route', async () => {
    // Identity documents are reachable only through an authorised controller, and
    // they must never be answered with the public shell.
    const response = await request(server)
      .get('/api/v1/probe/verification-documents/doc-1')
      .expect(200);

    expect(response.body).toEqual({ success: true, data: 'document-bytes' });
  });

  it('does not let the history fallback swallow the media mount', async () => {
    const response = await request(server).get('/media/user-1/AVATAR-missing.png').expect(404);

    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['content-type']).not.toContain('text/html');
  });

  it('only reserves whole path segments', async () => {
    // `/api/v11` is not the API, and `/mediaXyz` is not the media mount, so both
    // are ordinary client routes and get the shell.
    await request(server).get('/mediaXyz').expect(200);
    await request(server).get('/api/v11').expect(200);
  });

  it('leaves a non-GET request on an unknown path to the API', async () => {
    const response = await request(server).post('/not-a-route').expect(404);

    expect(response.headers['content-type']).toMatch(/json/);
  });
});

describe('web client hosting when the export has not been built', () => {
  it('mounts nothing at all, so the API behaves exactly as it always has', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'hz-no-export-')), 'dist');
    const { app, server } = await buildApp(baseConfig(missing));

    try {
      const response = await request(server).get('/').expect(404);

      expect(response.headers['content-type']).toMatch(/json/);
      // The API is untouched: its own routes still answer normally.
      await request(server).get('/api/v1/probe').expect(200);
    } finally {
      await app.close();
    }
  });
});

describe('web client hosting outside production', () => {
  it('stays unmounted even when a web export exists on disk', async () => {
    /*
     * Otherwise whether `/health` is an API 404 or a client route would depend on
     * whether a developer happened to run `pnpm build:web`, which is not a
     * property any deployment should have.
     */
    const webRoot = createWebExport();
    const { app, server } = await buildApp({ ...baseConfig(webRoot), isProduction: false });

    try {
      const response = await request(server).get('/').expect(404);

      expect(response.headers['content-type']).toMatch(/json/);
    } finally {
      await app.close();
    }
  });
});

describe('deployment port binding', () => {
  const production = { NODE_ENV: 'production', AUTH_JWT_SECRET: 'a'.repeat(32) };

  it('prefers the platform PORT over API_PORT', () => {
    const config = toAppConfig(envSchema.parse({ ...production, PORT: '43217', API_PORT: '4000' }));

    /*
     * Render routes traffic to the port it assigns in `PORT`, so binding to
     * `API_PORT` instead means the service is started and never reached.
     */
    expect(config.port).toBe(43217);
  });

  it('refuses to start on a PORT that is not a usable port number', () => {
    /*
     * Failing loudly is this schema's documented contract everywhere else: a
     * deployment with a broken value should stop at start-up rather than bind a
     * port the platform will not route to.
     */
    expect(() => envSchema.parse({ ...production, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('falls back to API_PORT when PORT is absent, as on a developer machine', () => {
    expect(toAppConfig(envSchema.parse({ PORT: undefined, API_PORT: '5555' })).port).toBe(5555);
    expect(toAppConfig(envSchema.parse({ API_PORT: undefined })).port).toBe(4000);
  });

  it('binds every interface in production whatever API_HOST says', () => {
    // A container is only reachable through all of its interfaces.
    expect(toAppConfig(envSchema.parse({ ...production, API_HOST: '127.0.0.1' })).host).toBe(
      '0.0.0.0',
    );
  });

  it('still honours API_HOST outside production', () => {
    const config = toAppConfig(envSchema.parse({ NODE_ENV: 'development', API_HOST: '127.0.0.1' }));

    expect(config.host).toBe('127.0.0.1');
  });

  it('resolves the web export against the repository root by default', () => {
    const config = toAppConfig(envSchema.parse({}));

    expect(config.webClientDir.endsWith(join('apps', 'frontend', 'dist'))).toBe(true);
  });
});

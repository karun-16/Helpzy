import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfigRef } from '../src/config/app-config.token';
import { PrismaService } from '../src/database/prisma.service';
import { HealthService } from '../src/health/health.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let databaseProbe: jest.Mock;

  beforeAll(async () => {
    databaseProbe = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The suite must not depend on a running PostgreSQL: the database probe
      // is stubbed so the HTTP contract can be tested in isolation. A dedicated
      // test below covers the failure path.
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $queryRaw: databaseProbe,
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Same bootstrap contract as `src/main.ts`.
    configureApp(app, moduleRef.get<AppConfigRef>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('GET /api/v1/health returns 200 with the shared success envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          status: 'UP',
          service: 'helpzy-api',
          environment: expect.any(String),
          version: expect.any(String),
          uptimeSeconds: expect.any(Number),
          timestamp: expect.any(String),
          checks: [
            expect.objectContaining({
              name: 'process',
              status: 'UP',
              latencyMs: expect.any(Number),
            }),
            expect.objectContaining({ name: 'database', status: 'UP' }),
          ],
        }),
        meta: expect.objectContaining({ requestId: expect.any(String) }),
      }),
    );
  });

  it('reports the database as DOWN while still answering 200 when the probe fails', async () => {
    databaseProbe.mockRejectedValueOnce(new Error('connection refused'));

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body.data.status).toBe('DOWN');
    expect(response.body.data.checks).toEqual([
      expect.objectContaining({ name: 'process', status: 'UP' }),
      expect.objectContaining({ name: 'database', status: 'DOWN' }),
    ]);
  });

  it('echoes an inbound x-request-id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'phase-1-test')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('phase-1-test');
    expect(response.body.meta.requestId).toBe('phase-1-test');
  });

  it('serves health only under the versioned API prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('returns a typed error envelope for unknown routes and hides internals', async () => {
    const response: Response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: 'NOT_FOUND',
        message: expect.any(String),
        requestId: expect.any(String),
        timestamp: expect.any(String),
      }),
    );
    expect(response.body.error).not.toHaveProperty('stack');
    // The router's own "Cannot GET /api/v1/does-not-exist" must not be echoed.
    expect(response.body.error.message).not.toContain('does-not-exist');
  });

  it('traces requests that match no route at all, inside or outside the prefix', async () => {
    for (const path of ['/does-not-exist', '/api/v1/does-not-exist']) {
      const response: Response = await request(app.getHttpServer()).get(path).expect(404);

      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'NOT_FOUND',
          requestId: response.headers['x-request-id'],
        }),
      );
      expect(response.body.error.message).toBe('The requested resource was not found.');
    }
  });

  it('never leaks an internal 500 message to the client', async () => {
    // `HealthService.check` is called through the injected instance, so spying
    // on it exercises the real global exception filter.
    jest.spyOn(app.get(HealthService), 'check').mockImplementation(() => {
      throw new Error('DATABASE_URL=postgres://user:secret@host/db is unreachable');
    });

    try {
      const response: Response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(500);

      expect(response.body.error).toEqual(
        expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR', requestId: expect.any(String) }),
      );
      expect(JSON.stringify(response.body)).not.toContain('secret');
      expect(JSON.stringify(response.body)).not.toContain('stack');
    } finally {
      // Restore immediately so the remaining specs see a healthy service again.
      jest.restoreAllMocks();
    }
  });

  it('keeps CORS working for errors, preflight and unknown origins', async () => {
    const allowed = 'http://localhost:8081';

    const notFound = await request(app.getHttpServer())
      .get('/does-not-exist')
      .set('Origin', allowed)
      .expect(404);
    expect(notFound.headers['access-control-allow-origin']).toBe(allowed);

    await request(app.getHttpServer())
      .options('/does-not-exist')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    const rejected = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://evil.example')
      .expect(200);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers on success, on 404 and on preflight', async () => {
    const required = [
      'x-content-type-options',
      'x-dns-prefetch-control',
      'x-frame-options',
      'referrer-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
      'origin-agent-cluster',
    ] as const;

    for (const path of ['/api/v1/health', '/api/v1/does-not-exist', '/does-not-exist']) {
      const response = await request(app.getHttpServer()).get(path);

      for (const header of required) {
        expect(response.headers[header]).toBeDefined();
      }
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // This API serves JSON only, so it must never be framed.
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      // The JSON body must not be sniffed into an executable type.
      expect(response.headers['content-type']).toContain('application/json');
    }
  });

  it('does not let Helmet remove the CORS headers', async () => {
    const allowed = 'http://localhost:8081';

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', allowed)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(allowed);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

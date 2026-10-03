import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { configureApp } from '../src/bootstrap';
import type { AppConfig } from '../src/config/env';

/**
 * Why this suite exists
 *
 * Helmet sets `Cross-Origin-Resource-Policy: same-origin` on every response,
 * which is right for a JSON API and wrong for the public `/media` mount. An
 * `<img>` on a different origin than the API is a no-cors request, so that
 * header is what decides whether a browser paints a profile photo at all. With
 * it left at `same-origin` the bytes were served, the avatar silently fell back
 * to initials, and an upload that had genuinely saved read as one that had not.
 *
 * The relaxation has to stay narrow: it belongs on the public mount only. The
 * API keeps Helmet's default, and the private verification documents are never
 * mounted publicly at all, so these two assertions are the guard on both.
 */

@Controller('probe')
class ProbeController {
  @Get()
  probe(): { success: true; data: string } {
    return { success: true, data: 'ok' };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe('public media mount', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let publicRoot: string;
  let privateRoot: string;

  beforeAll(async () => {
    publicRoot = mkdtempSync(join(tmpdir(), 'hz-public-media-'));
    privateRoot = mkdtempSync(join(tmpdir(), 'hz-private-media-'));
    mkdirSync(join(publicRoot, 'user-1'), { recursive: true });
    writeFileSync(join(publicRoot, 'user-1', 'AVATAR-test.png'), PNG_BYTES);

    const config = {
      globalPrefix: 'api/v1',
      corsOrigins: ['http://localhost:8081'],
      mediaMaxBytes: 5 * 1024 * 1024,
      mediaPublicBaseUrl: '/media',
      mediaUploadDir: publicRoot,
      privateMediaUploadDir: privateRoot,
      // No web export here: this suite is about media, and an absent export must
      // leave the media behaviour untouched.
      webClientDir: join(publicRoot, 'no-web-export'),
      isProduction: false,
      host: '0.0.0.0',
      port: 4000,
    } as AppConfig;

    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a profile photo with a cross-origin resource policy', async () => {
    const response = await request(server)
      .get('/media/user-1/AVATAR-test.png')
      .set('Origin', 'http://localhost:8081')
      .expect(200);

    /*
     * `same-origin` here is the bug: the bytes arrive, the browser declines to
     * paint them, and the avatar reports a load failure for a file that is
     * demonstrably there.
     */
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.body).toEqual(PNG_BYTES);
  });

  it('still answers a cross-origin request for a photo that does not exist', async () => {
    const response = await request(server).get('/media/user-1/missing.png').expect(404);

    // The header belongs to the mount, so it cannot depend on the file being found.
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('keeps Helmet default on the API itself', async () => {
    const response = await request(server).get('/api/v1/probe').expect(200);

    /*
     * The relaxation is scoped to the media mount. If this ever moves to
     * `cross-origin`, credentialed API responses would be readable from another
     * origin and the whole point of the explicit allow-list is gone.
     */
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('never exposes the private document root', async () => {
    writeFileSync(join(privateRoot, 'AADHAAR-test.png'), PNG_BYTES);

    // Written beside the public root rather than inside it, so no key can reach it.
    for (const path of ['/media/../AADHAAR-test.png', '/media/AADHAAR-test.png']) {
      await request(server).get(path).expect(404);
    }
  });
});

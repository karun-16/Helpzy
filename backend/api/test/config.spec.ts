import { isAbsolute, resolve } from 'node:path';

import { API_ROUTES, resolveApiBaseUrl, resolveApiGlobalPrefix } from '@helpzy/config';

import { envSchema, toAppConfig } from '../src/config/env';

describe('configuration', () => {
  it('serves health under the configured versioned API prefix', () => {
    expect(`${resolveApiGlobalPrefix({})}${API_ROUTES.health}`).toBe('api/v1/health');
  });

  it('falls back to sensible defaults when nothing is configured', () => {
    expect(resolveApiBaseUrl({})).toBe('http://localhost:4000');
    expect(resolveApiGlobalPrefix({})).toBe('api/v1');
  });

  it('normalises a trailing slash on the configured base URL', () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'http://api.local:4000//' })).toBe(
      'http://api.local:4000',
    );
  });

  it('treats "/" as "same origin as the page" for a single-host deployment', () => {
    /*
     * An empty base turns every request into a root-relative `/api/v1/...` URL,
     * so the browser sends it to the origin that served the app. `/` is the
     * explicit spelling because an empty environment variable reads as unset.
     */
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: '/' })).toBe('');
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: '.' })).toBe('');
  });

  it('keeps the loopback default when no base URL is configured', () => {
    // Development must be unaffected: the Expo dev server and the API are on
    // different ports, so there is no single origin to fall back to.
    expect(resolveApiBaseUrl({})).toBe('http://localhost:4000');
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: '' })).toBe('http://localhost:4000');
  });

  it('strips surrounding slashes from the global prefix', () => {
    expect(resolveApiGlobalPrefix({ API_GLOBAL_PREFIX: '/api/v2/' })).toBe('api/v2');
  });

  it('resolves relative media storage paths against the API package directory', () => {
    const defaultConfig = toAppConfig(envSchema.parse({}));
    const customConfig = toAppConfig(envSchema.parse({ MEDIA_UPLOAD_DIR: 'custom-media' }));

    expect(defaultConfig.mediaUploadDir).toBe(resolve(__dirname, '../uploads'));
    expect(isAbsolute(customConfig.mediaUploadDir)).toBe(true);
    expect(customConfig.mediaUploadDir).toBe(resolve(__dirname, '../custom-media'));
  });
});

describe('CORS allow-list', () => {
  // Go through the real schema so defaults are applied exactly as in production.
  const build = (apiCorsOrigins: string) =>
    toAppConfig(
      envSchema.parse({
        NODE_ENV: 'production',
        API_CORS_ORIGINS: apiCorsOrigins,
        AUTH_JWT_SECRET: 'test-only-jwt-secret-long-enough-for-validation',
      }),
    );

  it('parses an explicit list and trims whitespace', () => {
    expect(build(' http://localhost:8081 , http://a.test ').corsOrigins).toEqual([
      'http://localhost:8081',
      'http://a.test',
    ]);
  });

  it('never silently accepts a wildcard, because the API sends credentials', () => {
    expect(() => build('*')).toThrow(/wildcard/i);
    expect(() => build('http://a.test,*')).toThrow(/wildcard/i);
  });

  it('rejects the string `null` a browser sends from a sandboxed frame', () => {
    expect(() => build('null')).toThrow(/wildcard/i);
  });

  it('defaults to the documented local development origins', () => {
    expect(toAppConfig(envSchema.parse({ NODE_ENV: 'development' })).corsOrigins).toEqual([
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://localhost:19006',
      'http://127.0.0.1:19006',
    ]);
  });
});

describe('production authentication configuration', () => {
  it('rejects the development JWT default in production', () => {
    const developmentSecret = envSchema.parse({ NODE_ENV: 'development' }).AUTH_JWT_SECRET;

    expect(() => envSchema.parse({ NODE_ENV: 'production' })).toThrow(/AUTH_JWT_SECRET/);
    expect(() =>
      envSchema.parse({ NODE_ENV: 'production', AUTH_JWT_SECRET: developmentSecret }),
    ).toThrow(/AUTH_JWT_SECRET/);
  });

  it('accepts an explicitly configured production JWT secret of sufficient length', () => {
    expect(
      envSchema.safeParse({
        NODE_ENV: 'production',
        AUTH_JWT_SECRET: 'a'.repeat(32),
      }).success,
    ).toBe(true);
  });
});

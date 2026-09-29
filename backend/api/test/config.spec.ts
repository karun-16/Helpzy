import { OPERATIONAL_ROUTES, resolveApiBaseUrl, resolveApiGlobalPrefix } from '@helpzy/config';

import { envSchema, toAppConfig } from '../src/config/env';

describe('configuration', () => {
  it('serves the health check from the unversioned root path', () => {
    expect(OPERATIONAL_ROUTES.health).toBe('/health');
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

  it('strips surrounding slashes from the global prefix', () => {
    expect(resolveApiGlobalPrefix({ API_GLOBAL_PREFIX: '/api/v2/' })).toBe('api/v2');
  });
});

describe('CORS allow-list', () => {
  // Go through the real schema so defaults are applied exactly as in production.
  const build = (apiCorsOrigins: string) =>
    toAppConfig(envSchema.parse({ NODE_ENV: 'production', API_CORS_ORIGINS: apiCorsOrigins }));

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

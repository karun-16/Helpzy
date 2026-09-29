import { createApi, type HelpzyApi } from '@helpzy/api-client';

import { readAuthSession } from './auth-session';
import { appConfig } from './config';

/**
 * The single API client for the app.
 *
 * Built once, at module scope, so every screen shares one configuration and
 * one request timeout. Screens import `api` and never construct their own
 * client.
 */
export const api: HelpzyApi = createApi({
  baseUrl: appConfig.apiBaseUrl,
  timeoutMs: appConfig.apiTimeoutMs,
  globalPrefix: appConfig.apiGlobalPrefix,
  getAuthToken: () => readAuthSession()?.token,
});

export { ApiError } from '@helpzy/api-client';

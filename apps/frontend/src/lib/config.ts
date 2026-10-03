import Constants from 'expo-constants';
import {
  APP_NAME,
  APP_TAGLINE,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_GLOBAL_PREFIX,
  DEFAULT_API_TIMEOUT_MS,
} from '@helpzy/config';

/**
 * Public runtime configuration.
 *
 * Values come from `extra` in `app.config.ts`, which is the one place that
 * reads the root `.env`. The `process.env.EXPO_PUBLIC_*` fallbacks only apply
 * on web, where the bundler inlines those variables at build time; on Android
 * and iOS `process.env` is not a configuration channel, so `extra` is
 * authoritative there.
 */
interface AppExtra {
  appName?: string;
  appTagline?: string;
  apiBaseUrl?: string;
  apiTimeoutMs?: number;
  apiGlobalPrefix?: string;
  mediaMaxBytes?: number;
}

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

function inlinedWebEnv(): {
  apiBaseUrl?: string;
  apiTimeoutMs?: number;
  apiGlobalPrefix?: string;
  mediaMaxBytes?: number;
} {
  return {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    apiTimeoutMs: Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? '') || undefined,
    apiGlobalPrefix: process.env.EXPO_PUBLIC_API_GLOBAL_PREFIX,
    mediaMaxBytes: Number(process.env.MEDIA_MAX_BYTES ?? '') || undefined,
  };
}

const webEnv = inlinedWebEnv();

export const appConfig = {
  appName: extra.appName ?? APP_NAME,
  appTagline: extra.appTagline ?? APP_TAGLINE,
  apiBaseUrl: extra.apiBaseUrl ?? webEnv.apiBaseUrl ?? DEFAULT_API_BASE_URL,
  apiTimeoutMs: extra.apiTimeoutMs ?? webEnv.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  apiGlobalPrefix: extra.apiGlobalPrefix ?? webEnv.apiGlobalPrefix ?? DEFAULT_API_GLOBAL_PREFIX,
  mediaMaxBytes: extra.mediaMaxBytes ?? webEnv.mediaMaxBytes ?? 5 * 1024 * 1024,
} as const;

/** Resolve local API media URLs against the host this client actually uses. */
export function resolveMediaUrl(uri: string): string {
  if (uri.startsWith('data:')) return uri;
  try {
    const mediaUrl = new URL(uri, appConfig.apiBaseUrl);
    const apiUrl = new URL(appConfig.apiBaseUrl);
    const isLoopback = (hostname: string) =>
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    if (isLoopback(mediaUrl.hostname) && !isLoopback(apiUrl.hostname)) {
      mediaUrl.protocol = apiUrl.protocol;
      mediaUrl.host = apiUrl.host;
    }
    return mediaUrl.toString();
  } catch {
    return uri;
  }
}

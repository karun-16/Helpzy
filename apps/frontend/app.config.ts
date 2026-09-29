import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import dotenv from 'dotenv';

import {
  APP_TAGLINE,
  resolveApiBaseUrl,
  resolveApiGlobalPrefix,
  resolveApiTimeoutMs,
} from '@helpzy/config';

/**
 * Expo app configuration for every platform.
 *
 * There is a single configuration file and a single `.env` at the repository
 * root. The root file is loaded here and the values are handed to the app
 * through `extra` (readable on web, Android and iOS alike) instead of relying
 * on `process.env` being inlined into the bundle, which behaves differently per
 * platform.
 */
const workspaceRoot = resolve(__dirname, '../..');
// `quiet` keeps dotenv from printing its banner: Expo tools such as
// `expo-doctor` parse the CLI output of commands run from this file, and the
// extra line makes their dependency check fail.
dotenv.config({ path: resolve(workspaceRoot, '.env'), quiet: true });

const env = process.env;

const appName = env.EXPO_PUBLIC_APP_NAME ?? 'HELPZY';
const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: appName,
  slug,
  version: '0.1.0',
  orientation: 'portrait',
  scheme: slug,
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android', 'web'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.helpzy.app',
  },
  android: {
    package: 'com.helpzy.app',
  },
  web: {
    bundler: 'metro',
    // Single page application output. HELPZY is an authenticated, client-side
    // app with no SEO surface, so pre-rendered HTML is not needed and this
    // keeps the web build free of server-side rendering constraints.
    output: 'single',
  },
  plugins: ['expo-router'],
  extra: {
    appName,
    appTagline: env.EXPO_PUBLIC_APP_TAGLINE ?? APP_TAGLINE,
    apiBaseUrl: resolveApiBaseUrl(env),
    apiTimeoutMs: resolveApiTimeoutMs(env),
    apiGlobalPrefix: resolveApiGlobalPrefix(env),
  },
});

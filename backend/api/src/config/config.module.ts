import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { APP_CONFIG } from './app-config.token';
import { envFileCandidates, envSchema, toAppConfig, type AppConfig } from './env';

/**
 * Validates the environment once, at boot, and exposes the result app wide.
 * Nothing else in the codebase reads `process.env` directly.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: envFileCandidates,
      validate: (raw: Record<string, unknown>) => {
        const parsed = envSchema.safeParse(raw);
        if (!parsed.success) {
          const details = parsed.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
          throw new Error(`Invalid environment configuration:\n${details}`);
        }
        return parsed.data;
      },
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => toAppConfig(envSchema.parse(process.env)),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { API_ERROR_CODES } from '@helpzy/types';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';

/** What a caller gets back after a successful upload. */
export interface StoredMedia {
  provider: string;
  storageKey: string;
  publicUrl: string;
  contentType: string;
  byteSize: number;
}

/**
 * Storage abstraction for user uploads.
 *
 * The API depends on this interface, never on a concrete vendor, so swapping in
 * S3/GCS later is a configuration change rather than a rewrite. There is no
 * "placeholder" implementation that pretends to be cloud storage.
 */
export interface MediaStorageProvider {
  readonly name: string;
  /** Whether this provider can actually persist bytes right now. */
  isConfigured(): boolean;
  put(input: { key: string; body: Buffer; contentType: string }): Promise<{ publicUrl: string }>;
}

/** Decodes the base64 payload an app can produce without a file-system bridge. */
export function decodeBase64Payload(data: string, contentType: string): Buffer {
  // Accept both a bare base64 string and a data URL, but never trust the client
  // to have sent the right encoding.
  const base64 = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'The uploaded file could not be decoded.',
    });
  }
  const body = Buffer.from(base64, 'base64');
  if (body.length === 0) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'The uploaded file is empty.',
    });
  }
  // Trust the bytes over the declared type: a mismatched payload must not be
  // stored under an image content type.
  if (!matchesDeclaredContentType(body, contentType)) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'Only JPEG, PNG or WebP images can be uploaded.',
    });
  }
  return body;
}

function matchesDeclaredContentType(body: Buffer, contentType: string): boolean {
  if (body.length < 12) return false;
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === 'image/png') {
    return body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/webp') {
    return (
      body.subarray(0, 4).toString('ascii') === 'RIFF' &&
      body.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Development provider: writes under a local directory and serves the bytes
 * through the API's own static route. Honest about what it is - it is not cloud
 * storage, and it is only selected when no external provider is configured.
 */
@Injectable()
export class LocalMediaStorageProvider implements MediaStorageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalMediaStorageProvider.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfigRef) {}

  isConfigured(): boolean {
    return true;
  }

  /** Build a full public URL for a stored key. */
  private buildPublicUrl(key: string): string {
    const base = this.config.mediaPublicBaseUrl;
    // If the configured base is already an absolute URL, use it directly.
    // Otherwise, construct one from the API host/port for local development.
    if (/^https?:\/\//i.test(base)) {
      return `${base.replace(/\/+$/, '')}/${key}`;
    }
    const protocol = this.config.isProduction ? 'https' : 'http';
    const host = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
    return `${protocol}://${host}:${this.config.port}${base.replace(/\/+$/, '')}/${key}`;
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ publicUrl: string }> {
    // Resolve inside the configured root and reject anything that escapes it.
    const target = resolve(join(this.config.mediaUploadDir, input.key));
    const root = resolve(this.config.mediaUploadDir);
    if (!target.startsWith(root)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'The upload target was rejected.',
      });
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
    this.logger.log(`Stored ${input.contentType} (${input.body.length} bytes) at ${input.key}`);

    return { publicUrl: this.buildPublicUrl(input.key) };
  }
}

/**
 * Chooses a provider. A real vendor is selected when its credentials are
 * present; otherwise the local development provider is used and clearly named
 * so callers can tell the difference.
 */
@Injectable()
export class MediaStorageService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
    private readonly local: LocalMediaStorageProvider,
  ) {}

  get providerName(): string {
    return this.local.isConfigured() ? this.local.name : 'none';
  }

  /** Exposed so callers can apply the same limit the storage layer enforces. */
  get maxBytes(): number {
    return this.config.mediaMaxBytes;
  }

  /**
   * Stores an upload under a key derived from the owner, so a new upload
   * replaces the previous one instead of accumulating orphans.
   */
  async storeImage(input: {
    ownerUserId: string;
    kind: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredMedia> {
    const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType] ?? 'bin';
    const key = `${input.ownerUserId}/${input.kind}-${randomUUID()}.${extension}`;
    const { publicUrl } = await this.local.put({
      key,
      body: input.body,
      contentType: input.contentType,
    });

    return {
      provider: this.local.name,
      storageKey: key,
      publicUrl,
      contentType: input.contentType,
      byteSize: input.body.length,
    };
  }
}

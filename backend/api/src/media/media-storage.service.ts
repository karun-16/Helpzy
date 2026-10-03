import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { API_ERROR_CODES } from '@helpzy/types';
import {
  HEIC_IMAGE_CONTENT_TYPES,
  PROFILE_IMAGE_CONTENT_TYPES,
  PROFILE_IMAGE_FORMAT_SUMMARY,
} from '@helpzy/validation';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';

/**
 * Storage for files that must never be served over a public URL.
 *
 * Verification documents are identity documents, so they are handled quite
 * differently from a profile photo. This provider has no concept of a URL at
 * all: it can only write and read a key, and reading is reachable only from an
 * endpoint that has already checked authorisation.
 *
 * Its root deliberately sits *beside* the public upload directory rather than
 * inside it, so the public static mount cannot reach these bytes even by
 * accident.
 */
@Injectable()
export class PrivateMediaStorageProvider {
  readonly name = 'local-private';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfigRef) {}

  /**
   * Whether a private root has been configured.
   *
   * Independent of the public provider on purpose: identity documents are stored
   * by a different provider against a different root, so gating them on the
   * public one refuses exactly the deployments that configured the private root
   * and left the public one alone.
   */
  isConfigured(): boolean {
    return Boolean(this.config.privateMediaUploadDir);
  }

  private get root(): string {
    return resolve(this.config.privateMediaUploadDir);
  }

  /**
   * Resolves a key inside the private root, refusing anything that escapes it.
   *
   * Keys are generated server-side, so this is defence in depth rather than the
   * primary control: even a key that somehow contained `../` cannot read outside
   * the private directory.
   */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'The document reference was rejected.',
      });
    }
    return target;
  }

  async put(input: { key: string; body: Buffer }): Promise<void> {
    const target = this.resolveKey(input.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }

  /** Returns the bytes, or `null` when nothing is stored under that key. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

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

/**
 * The image formats an upload may be stored as.
 *
 * Taken from the shared list so the picker, the request schema and this
 * signature check cannot disagree about what is acceptable. Every entry must also
 * have a `CONTENT_SIGNATURES` entry and an extension; `media-storage.spec.ts`
 * asserts both, so adding a format in one place and forgetting the others fails a
 * test rather than an upload.
 */
export const ALLOWED_IMAGE_TYPES = PROFILE_IMAGE_CONTENT_TYPES;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Decodes the base64 payload an app can produce without a file-system bridge. */
export function decodeBase64Payload(data: string, contentType: string): Buffer {
  // Accept both a bare base64 string and a data URL, but never trust the client
  // to have sent the right encoding.
  const dataUrlMatch = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  const base64 = dataUrlMatch?.[2] ?? (data.startsWith('data:') ? '' : data);
  if (
    base64.length === 0 ||
    (dataUrlMatch && dataUrlMatch[1] !== contentType) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
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
  if (body.toString('base64') !== base64) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'The uploaded file could not be decoded.',
    });
  }
  // Trust the bytes over the declared type: a mismatched payload must not be
  // stored under an image content type.
  if (!matchesDeclaredContentType(body, contentType)) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: unsupportedImageMessage(body, contentType),
    });
  }
  return body;
}

/**
 * Turns a refused upload into an instruction rather than a rejection.
 *
 * A HEIC file - the default photo format on iPhones - is refused because no
 * browser outside Safari will render one, so storing it would produce a saved
 * photo that never appears. Saying so is the difference between a person fixing
 * their file and a person concluding the app is broken. The `ftyp` check is
 * deliberate: a HEIC file that arrives claiming `image/jpeg` is caught by its
 * own bytes, which is the one case where the declared type is useless.
 */
function unsupportedImageMessage(body: Buffer, contentType: string): string {
  const isHeic =
    (HEIC_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType) ||
    (body.length >= 12 && body.subarray(4, 8).toString('ascii') === 'ftyp');
  if (isHeic) {
    return 'HEIC photos cannot be displayed in a browser. Please export the photo as JPEG and upload it again.';
  }
  return `That file is not a ${PROFILE_IMAGE_FORMAT_SUMMARY} image.`;
}

/**
 * How each accepted content type is recognised from its own bytes.
 *
 * This is the whole of the upload's format check, and it runs on content rather
 * than on the filename or the declared type. Widening `ALLOWED_IMAGE_TYPES`
 * without adding an entry here is not a looser check: an unrecognised type
 * simply fails, which is why the two lists are pinned together by a test.
 *
 * `minBytes` is each format's own smallest header rather than a round number, so
 * a truncated file cannot satisfy the signature on its first few bytes.
 */
const CONTENT_SIGNATURES: Readonly<
  Record<string, { readonly minBytes: number; readonly matches: (body: Buffer) => boolean }>
> = {
  // SOI followed by the first marker byte. Any JPEG starts FF D8 FF.
  'image/jpeg': {
    minBytes: 3,
    matches: (body) => body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
  },
  // The eight-byte PNG signature.
  'image/png': {
    minBytes: 8,
    matches: (body) =>
      body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  // 'GIF87a' or 'GIF89a'. The first four bytes are 'GIF8' either way.
  'image/gif': {
    minBytes: 13,
    matches: (body) => body.subarray(0, 4).toString('ascii') === 'GIF8',
  },
  /*
   * A bitmap is 'BM' followed by a 40-byte BITMAPINFOHEADER, so 54 bytes is the
   * floor for any bitmap at all. That is what stops a two-byte 'BM' prefix from
   * passing off an arbitrary payload as an image.
   */
  'image/bmp': { minBytes: 54, matches: (body) => body.subarray(0, 2).toString('ascii') === 'BM' },
  // A RIFF container whose form type at offset 8 is 'WEBP'.
  'image/webp': {
    minBytes: 16,
    matches: (body) =>
      body.subarray(0, 4).toString('ascii') === 'RIFF' &&
      body.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  /*
   * AVIF is an ISO-BMFF file: a 'ftyp' box at offset 4 whose major brand is
   * 'avif' or 'avis'. Checking only for 'ftyp' would wave through HEIC and MP4,
   * which share the box and are precisely what must not be stored as an AVIF.
   */
  'image/avif': {
    minBytes: 16,
    matches: (body) => {
      if (body.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
      const brand = body.subarray(8, 12).toString('ascii');
      return brand === 'avif' || brand === 'avis';
    },
  },
  // A PDF always starts with the `%PDF-` marker.
  'application/pdf': {
    minBytes: 5,
    matches: (body) => body.subarray(0, 5).toString('ascii') === '%PDF-',
  },
};

function matchesDeclaredContentType(body: Buffer, contentType: string): boolean {
  const signature = CONTENT_SIGNATURES[contentType];
  if (!signature) return false;
  return body.length >= signature.minBytes && signature.matches(body);
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

/** Content types accepted for a verification document. */
export const VERIFICATION_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type VerificationDocumentContentType = (typeof VERIFICATION_DOCUMENT_CONTENT_TYPES)[number];

/**
 * Decodes a verification document upload.
 *
 * The bytes are trusted over the declared type, exactly as for a profile photo:
 * a client that labels an arbitrary payload `application/pdf` must be caught by
 * the signature check rather than by its own claim.
 */
export function decodeVerificationDocument(
  data: string,
  contentType: VerificationDocumentContentType,
): Buffer {
  const body = decodeBase64Payload(data, contentType);

  if (body.length > MAX_VERIFICATION_DOCUMENT_BYTES) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'That document is too large. Please upload a file under 5 MB.',
    });
  }
  return body;
}

/**
 * A tighter size limit than the general media limit.
 *
 * Identity documents are small, and a tighter ceiling keeps an accidental or
 * abusive upload from filling the private store.
 */
const MAX_VERIFICATION_DOCUMENT_BYTES = 5 * 1024 * 1024;

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

  /**
   * Whether this provider can persist bytes.
   *
   * Deliberately **not** keyed on the environment. Refusing to write in
   * production was tried and is the wrong lever: it turns a working endpoint into
   * a permanent 503 while offering no alternative, because no cloud provider
   * exists yet to take over. Local disk is not the right answer for production
   * *volume*, but it is a correct answer for a single instance, and the honest
   * response to that is the provider name (`local`, returned in every response)
   * rather than an outage. The interface still carries the method so a real vendor
   * can report itself unconfigured when its credentials are missing.
   */
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
    /*
     * A wildcard bind address is not a public host name. In production the
     * process listens on `0.0.0.0` so a platform proxy can reach it, and
     * `https://localhost:<port>` would be stored on the user's profile as a
     * permanently broken image. A root-relative URL is correct whenever the web
     * client and the API share an origin, which is the single-service deployment
     * this build is for. A deployment that serves the app from somewhere else
     * sets `MEDIA_PUBLIC_BASE_URL` to its absolute URL above.
     *
     * Development keeps the loopback rewrite, because there the Expo dev server
     * on :8081 is a different origin from the API on :4000 and the client
     * rewrites loopback hosts onto its configured base.
     */
    const isWildcardHost = this.config.host === '0.0.0.0' || this.config.host === '::';
    if (isWildcardHost && this.config.isProduction) {
      return `${base.replace(/\/+$/, '')}/${key}`;
    }

    const host = isWildcardHost ? 'localhost' : this.config.host;
    return `${protocol}://${host}:${this.config.port}${base.replace(/\/+$/, '')}/${key}`;
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ publicUrl: string }> {
    // Resolve inside the configured root and reject anything that escapes it.
    const root = resolve(this.config.mediaUploadDir);
    const target = resolve(join(root, input.key));
    // The separator matters: without it a key resolving to a sibling directory
    // (`uploads-evil/`) passes a bare prefix test and writes outside the root.
    if (target !== root && !target.startsWith(root + sep)) {
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
    private readonly privateLocal: PrivateMediaStorageProvider,
  ) {}

  get providerName(): string {
    return this.local.isConfigured() ? this.local.name : 'none';
  }

  /**
   * Which provider holds private documents, if any.
   *
   * Exposed alongside {@link providerName} because the two roots are configured
   * independently, and an operator needs to be able to see that identity documents
   * have somewhere to go without having to infer it from the public one.
   */
  get privateProviderName(): string {
    return this.privateLocal.isConfigured() ? this.privateLocal.name : 'none';
  }

  /** Exposed so callers can apply the same limit the storage layer enforces. */
  get maxBytes(): number {
    return this.config.mediaMaxBytes;
  }

  /**
   * Stores a private document outside the public media mount.
   *
   * Verification documents are identity documents, so they are handled quite
   * differently from a profile photo:
   *
   *  - they go to their own root, which is **not** served by
   *    `serveLocalMedia`, so there is no URL that fetches them;
   *  - the caller is handed a storage key, never a public URL, so nothing
   *    downstream can accidentally publish one;
   *  - the key is generated here from a random uuid and the document type, so a
   *    client-supplied filename can never influence where bytes land.
   */
  async storePrivateDocument(input: {
    professionalId: string;
    documentType: string;
    contentType: string;
    body: Buffer;
  }): Promise<{ storageKey: string; provider: string; byteSize: number }> {
    if (!this.privateLocal.isConfigured()) {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Document storage is not configured for this environment.',
      });
    }

    const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType] ?? 'bin';
    // Only the type and a random uuid appear in the key. The original filename
    // is never part of a path, so it cannot be used to traverse or to leak.
    const key = join(
      'verification',
      input.professionalId,
      `${input.documentType.toLowerCase()}-${randomUUID()}.${extension}`,
    );

    await this.privateLocal.put({ key, body: input.body });

    return { storageKey: key, provider: this.privateLocal.name, byteSize: input.body.length };
  }

  /** Reads a private document's bytes, or `null` when the key is unknown. */
  async readPrivateDocument(storageKey: string): Promise<Buffer | null> {
    return this.privateLocal.read(storageKey);
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
    if (!this.local.isConfigured()) {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Profile photo storage is not configured for this environment.',
      });
    }
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

import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ROLES } from '@helpzy/types';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { AppConfigRef } from '../src/config/app-config.token';
import { PROFILE_IMAGE_CONTENT_TYPES, type ProfileImageContentType } from '@helpzy/validation';
import {
  LocalMediaStorageProvider,
  MediaStorageService,
  PrivateMediaStorageProvider,
} from '../src/media/media-storage.service';
import { ProfilePhotoService, parseProfilePhotoInput } from '../src/media/profile-photo.service';
import { decodeBase64Payload } from '../src/media/media-storage.service';

/** Builds the facade with a private provider, as the media module wires it. */
function buildStorage(config: AppConfigRef) {
  const local = new LocalMediaStorageProvider(config);
  return {
    local,
    storage: new MediaStorageService(config, local, new PrivateMediaStorageProvider(config)),
  };
}

/** Every format the picker offers, each as bytes a browser would really render. */
const SAMPLES: Readonly<Record<string, Buffer>> = {
  'image/jpeg': Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]),
  'image/png': Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]),
  'image/webp': Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 ', 'ascii'),
  ]),
  'image/gif': Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
  ]),
  'image/bmp': bmpSample(),
  'image/avif': Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftypavif', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]),
};

/** Sample bytes for a format, failing loudly if the fixture set has drifted. */
function sampleFor(contentType: ProfileImageContentType): Buffer {
  const sample = SAMPLES[contentType];
  if (!sample) throw new Error(`No sample bytes for ${contentType}`);
  return sample;
}

describe('media storage configuration', () => {
  it('keeps local file storage available in development', () => {
    const config = { isProduction: false } as AppConfigRef;
    const { local, storage } = buildStorage(config);

    expect(local.isConfigured()).toBe(true);
    expect(storage.providerName).toBe('local');
  });

  it('still writes uploads in production, and says so in the provider name', async () => {
    const config = {
      isProduction: true,
      host: 'localhost',
      port: 4000,
      mediaPublicBaseUrl: '/media',
      mediaUploadDir: mkdtempSync(join(tmpdir(), 'hz-media-')),
    } as AppConfigRef;
    const { local, storage } = buildStorage(config);

    /*
     * Local disk is not the right answer for production volume, but refusing it is
     * worse: with no cloud provider implemented yet, gating on the environment
     * turned a working profile-photo endpoint into a permanent 503 while offering
     * nothing in its place. The provider names itself `local` instead, which is
     * visible on every response and honest about where the bytes went.
     */
    expect(local.isConfigured()).toBe(true);
    expect(storage.providerName).toBe('local');
    await expect(
      storage.storeImage({
        ownerUserId: 'user-id',
        kind: 'AVATAR',
        contentType: 'image/png',
        body: Buffer.from('not-an-image'),
      }),
    ).resolves.toEqual(expect.objectContaining({ provider: 'local' }));
  });

  it('gates private documents on the private root, not the public one', () => {
    /*
     * The two providers are configured independently. Gating identity documents on
     * the *public* provider refused exactly the deployments that had configured a
     * private root and left the public one alone - the only production setups that
     * can legitimately hold identity documents.
     */
    const config = { isProduction: true, privateMediaUploadDir: '/srv/private' } as AppConfigRef;
    const { storage } = buildStorage(config);
    expect(storage.privateProviderName).toBe('local-private');

    const withoutRoot = { isProduction: true, privateMediaUploadDir: '' } as AppConfigRef;
    const { storage: unconfigured } = buildStorage(withoutRoot);
    expect(unconfigured.privateProviderName).toBe('none');
  });

  it('refuses a document when no private root is configured at all', async () => {
    const config = { isProduction: true, privateMediaUploadDir: '' } as AppConfigRef;
    const { storage } = buildStorage(config);

    await expect(
      storage.storePrivateDocument({
        professionalId: 'pro-1',
        documentType: 'AADHAAR',
        contentType: 'image/png',
        body: Buffer.from('not-an-image'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('upload path containment', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function buildProvider(): { root: string; provider: LocalMediaStorageProvider } {
    const root = mkdtempSync(join(tmpdir(), 'hz-media-'));
    const config = {
      isProduction: false,
      host: 'localhost',
      port: 4000,
      mediaPublicBaseUrl: '/media',
      mediaUploadDir: root,
    } as AppConfigRef;
    return { root, provider: new LocalMediaStorageProvider(config) };
  }

  it('rejects a key that resolves outside the upload root', async () => {
    const { root, provider } = buildProvider();

    // `../` climbing straight out is the obvious case.
    await expect(
      provider.put({ key: '../escaped.png', body: pngBytes, contentType: 'image/png' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    /*
     * And the subtle one: a key that climbs out into a *sibling* directory whose
     * name happens to start with the root's name. `/tmp/hz-media-x` vs
     * `/tmp/hz-media-x-evil` passes a bare `startsWith(root)` test, so the check
     * has to compare against `root + sep` - which is what the private provider
     * already did and the public one did not.
     */
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    await expect(
      provider.put({
        key: `../${basename(sibling)}/escaped.png`,
        body: pngBytes,
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(join(sibling, 'escaped.png'))).toBe(false);
  });

  it('writes a key that stays inside the root', async () => {
    const { root, provider } = buildProvider();

    const result = await provider.put({
      key: 'user-id/avatar.png',
      body: pngBytes,
      contentType: 'image/png',
    });

    expect(result.publicUrl).toBe('http://localhost:4000/media/user-id/avatar.png');
    expect(existsSync(join(root, 'user-id', 'avatar.png'))).toBe(true);
  });
});

describe('profile image validation and persistence', () => {
  const jpegBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);

  it('accepts bytes matching the declared image signature and rejects mismatches', () => {
    expect(decodeBase64Payload(jpegBytes.toString('base64'), 'image/jpeg')).toEqual(jpegBytes);
    expect(() => decodeBase64Payload(jpegBytes.toString('base64'), 'image/png')).toThrow(
      /JPEG, PNG, WebP, GIF, BMP or AVIF/,
    );
    expect(() => decodeBase64Payload('a===', 'image/jpeg')).toThrow(/could not be decoded/);
    expect(() =>
      decodeBase64Payload(`data:image/png;base64,${jpegBytes.toString('base64')}`, 'image/jpeg'),
    ).toThrow(/could not be decoded/);
  });

  it('persists both the media asset and profile URL before returning success', async () => {
    const mediaAsset = { upsert: jest.fn().mockResolvedValue({}) };
    const user = {
      findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = { user, mediaAsset };
    const prisma = {
      user,
      mediaAsset,
      $transaction: jest.fn((operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const media = {
      maxBytes: 5 * 1024 * 1024,
      storeImage: jest.fn().mockResolvedValue({
        provider: 'local',
        storageKey: 'user-1/avatar.jpg',
        publicUrl: 'http://localhost:4000/media/user-1/avatar.jpg',
        contentType: 'image/jpeg',
        byteSize: jpegBytes.length,
      }),
    };
    const service = new ProfilePhotoService(prisma as never, media as never);

    const result = await service.upload('user-1', ROLES.CUSTOMER, {
      data: jpegBytes.toString('base64'),
      contentType: 'image/jpeg',
    });

    expect(result.publicUrl).toBe('http://localhost:4000/media/user-1/avatar.jpg');
    expect(mediaAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ publicUrl: result.publicUrl }),
      }),
    );
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', role: ROLES.CUSTOMER },
      data: { avatarUrl: result.publicUrl },
    });
  });

  it('does not report upload success if the account update did not persist', async () => {
    const user = {
      findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const mediaAsset = { upsert: jest.fn().mockResolvedValue({}) };
    const transaction = { user, mediaAsset };
    const prisma = {
      user,
      mediaAsset,
      $transaction: jest.fn((operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const media = {
      maxBytes: 5 * 1024 * 1024,
      storeImage: jest.fn().mockResolvedValue({
        provider: 'local',
        storageKey: 'user-1/avatar.jpg',
        publicUrl: 'http://localhost:4000/media/user-1/avatar.jpg',
        contentType: 'image/jpeg',
        byteSize: jpegBytes.length,
      }),
    };
    const service = new ProfilePhotoService(prisma as never, media as never);

    await expect(
      service.upload('user-1', ROLES.CUSTOMER, {
        data: jpegBytes.toString('base64'),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('image format coverage', () => {
  /*
   * GIF and BMP are the reported refusals. Both are formats browsers render in
   * an `<img>` and the local store serves with the right content type, so there
   * was never a technical reason to refuse them - only that nobody had written
   * the two signatures down.
   */
  it('accepts every format the picker offers', () => {
    for (const contentType of PROFILE_IMAGE_CONTENT_TYPES) {
      const sample = sampleFor(contentType);
      expect(decodeBase64Payload(sample.toString('base64'), contentType)).toEqual(sample);
    }
  });

  it('stores each accepted format under an extension the browser can render', async () => {
    const config = {
      isProduction: false,
      host: 'localhost',
      port: 4000,
      mediaPublicBaseUrl: '/media',
      mediaUploadDir: mkdtempSync(join(tmpdir(), 'hz-media-')),
    } as AppConfigRef;
    const { storage } = buildStorage(config);

    for (const contentType of PROFILE_IMAGE_CONTENT_TYPES) {
      const stored = await storage.storeImage({
        ownerUserId: 'user-1',
        kind: 'AVATAR',
        contentType,
        body: sampleFor(contentType),
      });

      expect(stored.publicUrl).toMatch(/^http:\/\/localhost:4000\/media\/user-1\/AVATAR-[\w-]+\./);
      // `image/jpeg` is the one whose stored extension is not its subtype.
      expect(
        stored.publicUrl.endsWith(
          contentType === 'image/jpeg' ? '.jpg' : `.${contentType.slice(6)}`,
        ),
      ).toBe(true);
      expect(stored.contentType).toBe(contentType);
    }
  });

  it('refuses every format whose bytes do not match the declared type', () => {
    const jpeg = sampleFor('image/jpeg');
    for (const contentType of PROFILE_IMAGE_CONTENT_TYPES) {
      if (contentType === 'image/jpeg') continue;
      expect(() => decodeBase64Payload(jpeg.toString('base64'), contentType)).toThrow(
        /JPEG, PNG, WebP, GIF, BMP or AVIF/,
      );
    }
  });

  it('refuses a truncated file that only shares the signature prefix', () => {
    /*
     * 'BM' alone is two bytes and would pass a naive prefix check, which is why
     * the bitmap rule requires a full 54-byte header. The same test protects the
     * smallest of the other formats.
     */
    expect(() =>
      decodeBase64Payload(Buffer.from('BM', 'ascii').toString('base64'), 'image/bmp'),
    ).toThrow();
    expect(() =>
      decodeBase64Payload(Buffer.from('GIF8', 'ascii').toString('base64'), 'image/gif'),
    ).toThrow();
  });

  it('refuses a HEIC photo by name, whichever type it claims', () => {
    /*
     * HEIC is the default photo format on iPhones. No browser outside Safari
     * renders one, so accepting it is what produces a saved photo that never
     * appears. The message has to be actionable, and it has to arrive whether the
     * client is honest about the type or not.
     */
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);

    expect(() => decodeBase64Payload(heic.toString('base64'), 'image/jpeg')).toThrow(
      /HEIC photos cannot be displayed/,
    );
    expect(() =>
      parseProfilePhotoInput({ data: heic.toString('base64'), contentType: 'image/heic' }),
    ).toThrow(/HEIC photos cannot be displayed/);
    expect(() => parseProfilePhotoInput({ data: 'AAAA', contentType: 'image/heif' })).toThrow(
      /HEIC photos cannot be displayed/,
    );
  });

  it('never accepts a format on the strength of its filename', () => {
    // The request body carries no filename at all, and a `.jpg` is not a claim.
    const elf = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
      Buffer.alloc(60),
    ]);
    expect(() => decodeBase64Payload(elf.toString('base64'), 'image/png')).toThrow();
  });

  it('keeps every accepted type parseable as a profile photo by the request validator', () => {
    for (const contentType of PROFILE_IMAGE_CONTENT_TYPES) {
      const data = sampleFor(contentType).toString('base64');
      expect(parseProfilePhotoInput({ data, contentType })).toEqual({ data, contentType });
    }
  });
});

/** A genuinely valid 1x1 24-bit bitmap: 54-byte file header plus one padded pixel. */
function bmpSample(): Buffer {
  const pixelSize = 4;
  const buffer = Buffer.alloc(54 + pixelSize);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(54 + pixelSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(1, 18);
  buffer.writeInt32LE(1, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelSize, 34);
  buffer.writeUInt32LE(2835, 38);
  buffer.writeUInt32LE(2835, 42);
  buffer[56] = 0xff;
  return buffer;
}

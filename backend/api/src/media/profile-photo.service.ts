import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, type Role } from '@helpzy/types';
import {
  HEIC_IMAGE_CONTENT_TYPES,
  PROFILE_IMAGE_FORMAT_SUMMARY,
  type ProfileImageContentType,
} from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { MediaStorageService, decodeBase64Payload } from './media-storage.service';

/**
 * The accepted photo types come from the shared list rather than being declared
 * here, so the picker this screen uses and the server cannot disagree about what
 * a person is allowed to upload.
 */
export const ALLOWED_PROFILE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
] as const satisfies readonly ProfileImageContentType[];
export type AllowedProfileImageType = (typeof ALLOWED_PROFILE_IMAGE_TYPES)[number];

export function parseProfilePhotoInput(body: unknown): {
  data: string;
  contentType: AllowedProfileImageType;
} {
  const input = (body ?? {}) as { data?: unknown; contentType?: unknown };
  const declared = typeof input.contentType === 'string' ? input.contentType : '';
  /*
   * Checked before the allow-list so a phone photo is told what to do about
   * itself. "Unsupported image" reads as a broken app; being told the file is
   * HEIC and needs exporting reads as an instruction.
   */
  if ((HEIC_IMAGE_CONTENT_TYPES as readonly string[]).includes(declared)) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message:
        'HEIC photos cannot be displayed in a browser. Please export the photo as JPEG and upload it again.',
    });
  }
  const contentType = ALLOWED_PROFILE_IMAGE_TYPES.find((type) => type === declared);
  if (typeof input.data !== 'string' || !contentType) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: `Provide a base64 image and its content type (${PROFILE_IMAGE_FORMAT_SUMMARY}).`,
    });
  }
  return { data: input.data, contentType };
}

/** Shared role-scoped avatar persistence for customer and professional accounts. */
@Injectable()
export class ProfilePhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageService,
  ) {}

  async upload(
    userId: string,
    role: Role,
    input: { data: string; contentType: AllowedProfileImageType },
  ) {
    const owner = await this.prisma.user.findFirst({
      where: { id: userId, role },
      select: { id: true },
    });
    if (!owner) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'Your account could not be found.',
      });
    }

    const body = decodeBase64Payload(input.data, input.contentType);
    if (body.length > this.media.maxBytes) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `That image is larger than the ${Math.floor(this.media.maxBytes / (1024 * 1024))} MB limit.`,
      });
    }

    const stored = await this.media.storeImage({
      ownerUserId: owner.id,
      kind: 'AVATAR',
      contentType: input.contentType,
      body,
    });

    await this.prisma.$transaction(async (transaction) => {
      await transaction.mediaAsset.upsert({
        where: { ownerUserId_kind: { ownerUserId: owner.id, kind: 'AVATAR' } },
        update: {
          provider: stored.provider,
          storageKey: stored.storageKey,
          publicUrl: stored.publicUrl,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
        },
        create: {
          ownerUserId: owner.id,
          kind: 'AVATAR',
          provider: stored.provider,
          storageKey: stored.storageKey,
          publicUrl: stored.publicUrl,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
        },
      });
      const updated = await transaction.user.updateMany({
        where: { id: owner.id, role },
        data: { avatarUrl: stored.publicUrl },
      });
      if (updated.count !== 1) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'Your account could not be found.',
        });
      }
    });

    return {
      kind: 'AVATAR',
      publicUrl: stored.publicUrl,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      provider: stored.provider,
    };
  }
}

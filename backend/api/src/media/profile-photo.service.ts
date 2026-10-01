import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, type Role } from '@helpzy/types';

import { PrismaService } from '../database/prisma.service';
import { MediaStorageService, decodeBase64Payload } from './media-storage.service';

export const ALLOWED_PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedProfileImageType = (typeof ALLOWED_PROFILE_IMAGE_TYPES)[number];

export function parseProfilePhotoInput(body: unknown): {
  data: string;
  contentType: AllowedProfileImageType;
} {
  const input = (body ?? {}) as { data?: unknown; contentType?: unknown };
  const contentType = ALLOWED_PROFILE_IMAGE_TYPES.find((type) => type === input.contentType);
  if (typeof input.data !== 'string' || !contentType) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'Provide a base64 image and its content type.',
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

    await this.prisma.$transaction([
      this.prisma.mediaAsset.upsert({
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
      }),
      this.prisma.user.updateMany({
        where: { id: owner.id, role },
        data: { avatarUrl: stored.publicUrl },
      }),
    ]);

    return {
      kind: 'AVATAR',
      publicUrl: stored.publicUrl,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      provider: stored.provider,
    };
  }
}

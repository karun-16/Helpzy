import { Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, BOOKING_STATUSES, ROLES } from '@helpzy/types';
import type { ProfessionalOwnProfileDto, UpdateProfessionalProfileDto } from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { ProfilePhotoService, type AllowedProfileImageType } from '../media/profile-photo.service';

/**
 * A professional's own profile and availability.
 *
 * The professional owns everything here except their verification status, which
 * only an admin may change. There is deliberately no way to set `role`,
 * `verification` or a rating from this side of the API.
 */
@Injectable()
export class ProfessionalProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilePhotos: ProfilePhotoService,
  ) {}

  uploadAvatar(userId: string, input: { data: string; contentType: AllowedProfileImageType }) {
    return this.profilePhotos.upload(userId, ROLES.PROFESSIONAL, input);
  }

  async getOwnProfile(userId: string): Promise<ProfessionalOwnProfileDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: ROLES.PROFESSIONAL },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        avatarUrl: true,
        professionalProfile: {
          select: {
            id: true,
            businessName: true,
            bio: true,
            serviceArea: true,
            contactEmail: true,
            isPhoneVisible: true,
            yearsOfExperience: true,
            workingHours: true,
            verification: true,
            verifiedAt: true,
            rejectionNote: true,
            isLocationSharingEnabled: true,
          },
        },
      },
    });

    if (!user?.professionalProfile) throw profileNotFound();
    const profile = user.professionalProfile;

    // Counted from closed bookings so a professional cannot inflate it.
    const [completedCount, rating] = await Promise.all([
      this.prisma.booking.count({
        where: { professionalId: profile.id, status: BOOKING_STATUSES.CLOSED },
      }),
      this.prisma.review.aggregate({
        where: { status: 'PUBLISHED', booking: { professionalId: profile.id } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return {
      id: user.id,
      userId: user.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      avatarUrl: user.avatarUrl,
      businessName: profile.businessName,
      bio: profile.bio,
      serviceArea: profile.serviceArea,
      contactEmail: profile.contactEmail,
      isPhoneVisible: profile.isPhoneVisible,
      // The schema has these as nullable, and an unset value is shown as unset
      // rather than guessed at.
      yearsOfExperience: profile.yearsOfExperience,
      workingHours: parseWorkingHours(profile.workingHours),
      verification: profile.verification,
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
      rejectionNote: profile.rejectionNote,
      isLocationSharingEnabled: profile.isLocationSharingEnabled,
      completedCount,
      averageRating: rating._avg.rating ?? 0,
      ratingCount: rating._count.rating,
    };
  }

  async updateOwnProfile(
    userId: string,
    input: UpdateProfessionalProfileDto,
  ): Promise<ProfessionalOwnProfileDto> {
    await this.getProfileRow(userId);

    // `fullName` and `avatarUrl` live on the user, everything else on the
    // profile. Split so neither table can be given a field it does not own.
    await this.prisma.$transaction(async (transaction) => {
      if (input.fullName !== undefined || input.avatarUrl !== undefined) {
        await transaction.user.updateMany({
          where: { id: userId, role: ROLES.PROFESSIONAL },
          data: {
            ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
            ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          },
        });
      }

      await transaction.professionalProfile.updateMany({
        where: { userId },
        data: {
          ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.serviceArea !== undefined ? { serviceArea: input.serviceArea } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
          ...(input.isPhoneVisible !== undefined ? { isPhoneVisible: input.isPhoneVisible } : {}),
          ...(input.yearsOfExperience !== undefined
            ? { yearsOfExperience: input.yearsOfExperience }
            : {}),
          ...(input.workingHours !== undefined
            ? { workingHours: input.workingHours as unknown as Prisma.InputJsonValue }
            : {}),
          ...(input.isLocationSharingEnabled !== undefined
            ? { isLocationSharingEnabled: input.isLocationSharingEnabled }
            : {}),
        },
      });
    });

    return this.getOwnProfile(userId);
  }

  private async getProfileRow(userId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw profileNotFound();
    return profile;
  }
}

/**
 * `workingHours` is a `Json` column, so the stored shape is only guaranteed at
 * runtime. It is re-validated instead of cast, so a legacy or hand-edited row
 * degrades to an empty schedule rather than crashing the profile screen.
 */
function parseWorkingHours(value: Prisma.JsonValue | null): [] {
  if (!Array.isArray(value)) return [];
  return value as [];
}

function profileNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'Your professional profile could not be found.',
  });
}

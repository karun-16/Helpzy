import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, ACTIVE_JOB_STATUSES } from '@helpzy/types';
import type {
  AssignedProfessionalLocationDto,
  BookingStatus,
  ProfessionalLocationUpdateDto,
} from '@helpzy/validation';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';

/**
 * Optional, opt-in location sharing for an in-progress job.
 *
 * The rules this module exists to enforce:
 *
 * - A professional must explicitly enable sharing on their profile. It is off by
 *   default, and there is no way to enable it from the customer's side.
 * - A location is only ever written by the professional's own device, for their
 *   own profile. Nothing here accepts a target user id.
 * - A customer sees a location only for their own booking, and only while that
 *   booking is active. Once the job ends, the last known position is no longer
 *   exposed through the booking at all.
 * - A stale position is reported as stale rather than presented as live. A
 *   missing position is reported as missing - never as a guessed default.
 */
@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
  ) {}

  /**
   * Records a position reported by the professional's own device.
   *
   * Refused when sharing is off, so the stored `lastKnown*` fields can never
   * accumulate a trail for someone who has not opted in.
   */
  async updateOwnLocation(
    professionalUserId: string,
    input: ProfessionalLocationUpdateDto,
  ): Promise<{ updatedAt: string }> {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: professionalUserId },
      select: { id: true, isLocationSharingEnabled: true },
    });
    if (!profile) throw professionalNotFound();

    if (!profile.isLocationSharingEnabled) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'Turn on location sharing in your profile before sharing your position.',
      });
    }

    const updated = await this.prisma.professionalProfile.update({
      where: { id: profile.id },
      data: {
        lastKnownLatitude: input.latitude,
        lastKnownLongitude: input.longitude,
        locationUpdatedAt: new Date(),
      },
      select: { locationUpdatedAt: true },
    });

    return { updatedAt: (updated.locationUpdatedAt ?? new Date()).toISOString() };
  }

  /**
   * The assigned professional's last reported position for one of the customer's
   * own bookings.
   */
  async getForBooking(
    customerId: string,
    bookingId: string,
  ): Promise<AssignedProfessionalLocationDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      select: {
        status: true,
        reference: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            isLocationSharingEnabled: true,
            lastKnownLatitude: true,
            lastKnownLongitude: true,
            locationUpdatedAt: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });
    if (!booking) throw bookingNotFound();

    return this.project(booking.reference, booking.status as BookingStatus, booking.professional);
  }

  private project(
    reference: string,
    status: BookingStatus,
    professional: {
      id: string;
      businessName: string;
      isLocationSharingEnabled: boolean;
      lastKnownLatitude: { toNumber: () => number } | null;
      lastKnownLongitude: { toNumber: () => number } | null;
      locationUpdatedAt: Date | null;
      user: { fullName: string };
    },
  ): AssignedProfessionalLocationDto {
    const isActiveJob = ACTIVE_JOB_STATUSES.includes(status);
    const base = { bookingReference: reference, professionalName: professional.user.fullName };

    // Three honest "no position" outcomes, and no fourth that invents one.
    if (!professional.isLocationSharingEnabled) {
      return {
        ...base,
        available: false,
        reason: 'SHARING_DISABLED',
        latitude: null,
        longitude: null,
        updatedAt: null,
        isStale: null,
      };
    }
    if (!isActiveJob) {
      return {
        ...base,
        available: false,
        reason: 'BOOKING_NOT_ACTIVE',
        latitude: null,
        longitude: null,
        updatedAt: null,
        isStale: null,
      };
    }
    if (
      professional.lastKnownLatitude === null ||
      professional.lastKnownLongitude === null ||
      professional.locationUpdatedAt === null
    ) {
      // Sharing is on and the job is running, but the device has not reported a
      // position yet. Distinct from a stale fix, and reported as such.
      return {
        ...base,
        available: false,
        reason: 'NO_REPORTED_POSITION',
        latitude: null,
        longitude: null,
        updatedAt: null,
        isStale: null,
      };
    }

    const updatedAt = professional.locationUpdatedAt;
    const ageMinutes = (Date.now() - updatedAt.getTime()) / 60_000;

    return {
      ...base,
      available: true,
      reason: null,
      latitude: professional.lastKnownLatitude.toNumber(),
      longitude: professional.lastKnownLongitude.toNumber(),
      updatedAt: updatedAt.toISOString(),
      // A stale fix is still returned - the professional may simply be waiting -
      // but flagged so the client labels it rather than showing it as live.
      isStale: ageMinutes > this.config.locationStaleMinutes,
    };
  }
}

function bookingNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested booking was not found.',
  });
}

function professionalNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'Your professional profile could not be found.',
  });
}

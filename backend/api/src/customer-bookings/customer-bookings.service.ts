import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { API_ERROR_CODES, NOTIFICATION_TYPES, ROLES, type BookingStatus } from '@helpzy/types';
import {
  createCustomerBookingSchema,
  type BookingTimelineEntryDto,
  type CustomerBookingDto,
} from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { BookingLifecycleService } from '../bookings/booking-lifecycle.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const bookingInclude = {
  service: { select: { id: true, title: true } },
  professional: {
    select: {
      id: true,
      user: { select: { fullName: true } },
      businessName: true,
    },
  },
  address: {
    select: {
      label: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
    },
  },
} satisfies Prisma.BookingInclude;

type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

@Injectable()
export class CustomerBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(customerId: string, input: unknown): Promise<CustomerBookingDto> {
    const parsed = createCustomerBookingSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Please check the booking details and try again.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }

    const scheduledStart = new Date(parsed.data.scheduledStart);
    if (!Number.isFinite(scheduledStart.getTime()) || scheduledStart.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a valid future date and time.',
      });
    }

    const customer = await this.prisma.user.findFirst({
      where: { id: customerId, role: ROLES.CUSTOMER, status: 'ACTIVE' },
      select: { id: true, fullName: true },
    });
    if (!customer) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The customer account could not be found.',
      });
    }

    const service = await this.prisma.service.findFirst({
      where: {
        id: parsed.data.serviceId,
        ownerId: parsed.data.professionalId,
        isActive: true,
        category: { is: { isActive: true } },
        owner: {
          is: {
            role: ROLES.PROFESSIONAL,
            status: 'ACTIVE',
            professionalProfile: { isNot: null },
          },
        },
      },
      select: {
        id: true,
        durationMinutes: true,
        basePrice: true,
        currency: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            professionalProfile: { select: { id: true } },
          },
        },
      },
    });
    if (!service?.owner.professionalProfile) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The selected professional does not offer this service.',
      });
    }

    const scheduledEnd = new Date(scheduledStart.getTime() + service.durationMinutes * 60_000);
    try {
      const booking = await this.prisma.$transaction(async (transaction) => {
        let addressId = parsed.data.addressId;
        if (addressId) {
          const savedAddress = await transaction.address.findFirst({
            where: { id: addressId, userId: customer.id },
            select: { id: true },
          });
          if (!savedAddress) {
            throw new NotFoundException({
              code: API_ERROR_CODES.NOT_FOUND,
              message: 'That saved address could not be found.',
            });
          }
          addressId = savedAddress.id;
        } else if (parsed.data.address) {
          const address = await transaction.address.create({
            data: {
              userId: customer.id,
              label: parsed.data.address.label,
              type: parsed.data.address.type ?? 'OTHER',
              line1: parsed.data.address.line1,
              line2: parsed.data.address.line2 || null,
              city: parsed.data.address.city,
              state: parsed.data.address.state,
              postalCode: parsed.data.address.postalCode,
            },
            select: { id: true },
          });
          addressId = address.id;
        }
        if (!addressId) throw new Error('A service address was not resolved.');
        const booking = await transaction.booking.create({
          data: {
            reference: `HZ-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
            customerId: customer.id,
            professionalId: service.owner.professionalProfile!.id,
            serviceId: service.id,
            addressId,
            status: 'REQUESTED',
            scheduledStart,
            scheduledEnd,
            priceAmount: service.basePrice,
            currency: service.currency,
            customerNote: parsed.data.requirement || null,
          },
          include: bookingInclude,
        });
        await transaction.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: null,
            toStatus: 'REQUESTED',
            actorUserId: customer.id,
          },
        });
        await this.notifications.emit(
          [
            this.notifications.customerBookingEvent({
              type: NOTIFICATION_TYPES.BOOKING_REQUESTED,
              customerUserId: customer.id,
              bookingId: booking.id,
              bookingReference: booking.reference,
              professionalName: service.owner.fullName,
            }),
            this.notifications.professionalBookingEvent({
              type: NOTIFICATION_TYPES.BOOKING_REQUESTED,
              professionalUserId: service.owner.id,
              bookingId: booking.id,
              bookingReference: booking.reference,
              customerName: customer.fullName,
            }),
          ],
          transaction,
        );
        return booking;
      });
      return this.toDto(booking);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'That time is no longer available. Choose another time.',
        });
      }
      throw error;
    }
  }

  async list(customerId: string): Promise<CustomerBookingDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { customerId },
      include: bookingInclude,
    });
    const upcoming = bookings
      .filter((booking) => booking.scheduledStart.getTime() >= Date.now())
      .sort((left, right) => left.scheduledStart.getTime() - right.scheduledStart.getTime());
    const past = bookings
      .filter((booking) => booking.scheduledStart.getTime() < Date.now())
      .sort((left, right) => right.scheduledStart.getTime() - left.scheduledStart.getTime());
    return [...upcoming, ...past].map((booking) => this.toDto(booking));
  }

  async get(customerId: string, bookingId: string): Promise<CustomerBookingDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      include: bookingInclude,
    });
    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The requested booking was not found.',
      });
    }
    return this.toDto(booking);
  }

  /**
   * The recorded status transitions for one of the customer's own bookings.
   *
   * Read straight from `booking_status_history`, which is written in the same
   * transaction as each status change. No step is inferred, back-filled or
   * generated here, so the timeline is exactly what happened.
   */
  async timeline(customerId: string, bookingId: string): Promise<BookingTimelineEntryDto[]> {
    // Scoping the lookup to the customer first means a booking that belongs to
    // somebody else reports "not found" rather than leaking its history.
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The requested booking was not found.',
      });
    }

    const entries = await this.prisma.bookingStatusHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actorUserId: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      actorName: entry.actor.fullName,
      isOwnAction: entry.actorUserId === customerId,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  /**
   * Confirms a booking the professional marked complete. The customer identity
   * comes from the session and the booking is scoped to them, so neither
   * `customerId` nor `professionalId` is ever accepted from the client.
   */
  async confirmCompletion(customerId: string, bookingId: string): Promise<CustomerBookingDto> {
    await this.lifecycle.applyCustomerConfirmation({
      bookingId,
      customerId,
      actorUserId: customerId,
    });

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      include: bookingInclude,
    });
    if (!booking) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The requested booking was not found.',
      });
    }
    return this.toDto(booking);
  }

  private toDto(booking: BookingRecord): CustomerBookingDto {
    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status as BookingStatus,
      scheduledStart: booking.scheduledStart.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      requirement: booking.customerNote,
      service: booking.service,
      professional: {
        id: booking.professional.id,
        fullName: booking.professional.user.fullName,
        businessName: booking.professional.businessName,
      },
      location: booking.address,
    };
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}

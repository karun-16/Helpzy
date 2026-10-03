import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_AUDIT_ACTIONS,
  API_ERROR_CODES,
  BOOKING_STATUSES,
  NOTIFICATION_TYPES,
  PROFESSIONAL_VERIFICATION_STATUSES,
  REVIEW_STATUSES,
  ROLES,
  USER_STATUSES,
  type BookingStatus,
  type ProfessionalVerificationStatus,
  type UserStatus,
} from '@helpzy/types';
import type {
  AdminAuditEntryDto,
  AdminDashboardSummaryDto,
  AdminProfessionalDetailDto,
  AdminUserSummaryDto,
  AdminVerificationRequestDto,
} from '@helpzy/validation';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Administrative oversight.
 *
 * Every mutating action here is audited, and every one resolves its target from
 * the database rather than trusting the payload. An admin is deliberately not
 * given a way to edit a booking, invent a review or mark a payment paid - the
 * booking state machine and the payment rules stay the only paths to those
 * states.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Counts only. Nothing here is estimated or cached from a stale source. */
  async dashboardSummary(): Promise<AdminDashboardSummaryDto> {
    const [
      customers,
      professionals,
      admins,
      bookingsByStatus,
      paymentsByStatus,
      reviewsByStatus,
      pendingVerifications,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: ROLES.CUSTOMER } }),
      this.prisma.user.count({ where: { role: ROLES.PROFESSIONAL } }),
      this.prisma.user.count({ where: { role: ROLES.ADMIN } }),
      this.prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.review.groupBy({ by: ['status'], _count: { _all: true } }),
      // Matches the queue in `listVerificationRequests`: an undecided
      // professional is one waiting for a decision, whatever their label.
      this.prisma.professionalProfile.count({
        where: {
          verification: {
            in: [
              PROFESSIONAL_VERIFICATION_STATUSES.UNVERIFIED,
              PROFESSIONAL_VERIFICATION_STATUSES.PENDING,
            ],
          },
        },
      }),
    ]);

    const countOf = <T>(rows: Array<{ status: T; _count: { _all: number } }>, status: T) =>
      rows.find((row) => row.status === status)?._count._all ?? 0;

    // Every status is present with a 0 default, so the dashboard cannot imply a
    // status does not exist simply because nothing is in it.
    const byStatus = Object.fromEntries(
      Object.values(BOOKING_STATUSES).map((status) => [status, countOf(bookingsByStatus, status)]),
    ) as Record<BookingStatus, number>;

    return {
      users: {
        total: customers + professionals + admins,
        customers,
        professionals,
        admins,
      },
      bookings: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
      },
      payments: {
        total: paymentsByStatus.reduce((sum, row) => sum + row._count._all, 0),
        paid: countOf(paymentsByStatus, 'PAID'),
        pending: countOf(paymentsByStatus, 'PENDING') + countOf(paymentsByStatus, 'PROCESSING'),
        failed: countOf(paymentsByStatus, 'FAILED'),
      },
      reviews: {
        total: reviewsByStatus.reduce((sum, row) => sum + row._count._all, 0),
        pending: countOf(reviewsByStatus, REVIEW_STATUSES.PENDING),
        published: countOf(reviewsByStatus, REVIEW_STATUSES.PUBLISHED),
      },
      pendingVerifications,
      // Counted across every user, not just the admin's own.
      unreadNotifications: await this.prisma.notification.count({ where: { readAt: null } }),
    };
  }

  async listUsers(
    options: { role?: string; status?: string; search?: string; categoryId?: string } = {},
  ): Promise<AdminUserSummaryDto[]> {
    if (
      options.role &&
      !Object.values(ROLES).includes(options.role as (typeof ROLES)[keyof typeof ROLES])
    ) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a valid account role.',
      });
    }
    if (options.status && !Object.values(USER_STATUSES).includes(options.status as UserStatus)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a valid account status.',
      });
    }
    if (options.categoryId && !isUuid(options.categoryId)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a valid service category.',
      });
    }
    const search = options.search?.trim().slice(0, 100);
    const users = await this.prisma.user.findMany({
      where: {
        ...(options.role ? { role: options.role as (typeof ROLES)[keyof typeof ROLES] } : {}),
        ...(options.status ? { status: options.status as UserStatus } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(options.categoryId
          ? {
              services: {
                some: { categoryId: options.categoryId, isActive: true },
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
      take: 200,
    });

    return users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    }));
  }

  async getProfessionalDetail(userId: string): Promise<AdminProfessionalDetailDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: ROLES.PROFESSIONAL },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        professionalProfile: {
          select: {
            id: true,
            businessName: true,
            bio: true,
            serviceArea: true,
            contactEmail: true,
            isPhoneVisible: true,
            yearsOfExperience: true,
            verification: true,
            verifiedAt: true,
            rejectionNote: true,
            createdAt: true,
            completedCount: true,
            averageRating: true,
            ratingCount: true,
          },
        },
        services: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            title: true,
            description: true,
            summary: true,
            basePrice: true,
            currency: true,
            isActive: true,
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!user?.professionalProfile) throw userNotFound();

    const profile = user.professionalProfile;
    const [bookings, reviews] = await Promise.all([
      this.prisma.booking.findMany({
        where: { professionalId: profile.id },
        orderBy: { scheduledStart: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          status: true,
          scheduledStart: true,
          service: { select: { title: true } },
          customer: { select: { fullName: true } },
        },
      }),
      this.prisma.review.findMany({
        where: { booking: { professionalId: profile.id } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          rating: true,
          comment: true,
          status: true,
          createdAt: true,
          customer: { select: { fullName: true } },
          booking: {
            select: {
              reference: true,
              service: { select: { title: true } },
            },
          },
        },
      }),
    ]);

    return {
      id: user.id,
      profileId: profile.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      avatarUrl: user.avatarUrl,
      accountStatus: user.status,
      accountCreatedAt: user.createdAt.toISOString(),
      businessName: profile.businessName,
      bio: profile.bio,
      serviceArea: profile.serviceArea,
      contactEmail: profile.contactEmail,
      isPhoneVisible: profile.isPhoneVisible,
      yearsOfExperience: profile.yearsOfExperience,
      verification: profile.verification,
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
      rejectionNote: profile.rejectionNote,
      profileCreatedAt: profile.createdAt.toISOString(),
      completedCount: profile.completedCount,
      averageRating: Number(profile.averageRating),
      ratingCount: profile.ratingCount,
      services: user.services.map((service) => ({
        id: service.id,
        title: service.title,
        description: service.description,
        summary: service.summary,
        price: Number(service.basePrice),
        currency: service.currency,
        active: service.isActive,
        category: service.category,
      })),
      bookings: bookings.map((booking) => ({
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        scheduledStart: booking.scheduledStart.toISOString(),
        serviceTitle: booking.service.title,
        customerName: booking.customer.fullName,
      })),
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        createdAt: review.createdAt.toISOString(),
        customerName: review.customer.fullName,
        serviceTitle: review.booking.service?.title ?? '',
        bookingReference: review.booking.reference,
      })),
    };
  }

  async listBookings(
    filter: {
      search?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const status = filter.status?.trim();
    if (status && !Object.values(BOOKING_STATUSES).includes(status as BookingStatus)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a valid booking status.',
      });
    }
    const from = parseFilterDate(filter.from, 'from');
    const to = parseFilterDate(filter.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'The start date must be before the end date.',
      });
    }
    const search = filter.search?.trim().slice(0, 100);
    const bookings = await this.prisma.booking.findMany({
      where: {
        ...(status ? { status: status as BookingStatus } : {}),
        ...(from || to
          ? { scheduledStart: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(search
          ? {
              OR: [
                { reference: { contains: search, mode: 'insensitive' } },
                { customer: { fullName: { contains: search, mode: 'insensitive' } } },
                { professional: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
                { professional: { businessName: { contains: search, mode: 'insensitive' } } },
                { service: { title: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ scheduledStart: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        reference: true,
        status: true,
        scheduledStart: true,
        createdAt: true,
        priceAmount: true,
        currency: true,
        service: { select: { title: true } },
        customer: { select: { fullName: true } },
        professional: {
          select: { businessName: true, user: { select: { fullName: true } } },
        },
        payment: { select: { status: true } },
        review: { select: { status: true } },
      },
    });
    return bookings.map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      scheduledStart: booking.scheduledStart.toISOString(),
      createdAt: booking.createdAt.toISOString(),
      amount: Number(booking.priceAmount),
      currency: booking.currency,
      serviceTitle: booking.service.title,
      customerName: booking.customer.fullName,
      professionalName: booking.professional.user.fullName,
      businessName: booking.professional.businessName,
      paymentStatus: booking.payment?.status ?? null,
      reviewStatus: booking.review?.status ?? null,
    }));
  }

  /**
   * Suspends or reactivates a user.
   *
   * Refused for admins: suspending the last active admin would lock everyone out
   * of the console with no way back in through the API.
   */
  async setUserStatus(
    adminId: string,
    userId: string,
    status: UserStatus,
  ): Promise<AdminUserSummaryDto> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw userNotFound();
    if (target.id === adminId) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'You cannot change the status of your own account.',
      });
    }
    if (target.role === ROLES.ADMIN && status !== USER_STATUSES.ACTIVE) {
      const activeAdmins = await this.prisma.user.count({
        where: { role: ROLES.ADMIN, status: USER_STATUSES.ACTIVE },
      });
      if (activeAdmins <= 1) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message: 'This is the last active admin and cannot be suspended.',
        });
      }
    }
    if (target.status === status) return this.toUserSummary(userId);

    await this.prisma.user.update({ where: { id: userId }, data: { status } });

    await this.audit.record({
      actorUserId: adminId,
      action:
        status === USER_STATUSES.ACTIVE
          ? ADMIN_AUDIT_ACTIONS.USER_REACTIVATED
          : ADMIN_AUDIT_ACTIONS.USER_SUSPENDED,
      entityType: 'USER',
      entityId: userId,
      metadata: { from: target.status, to: status },
    });

    return this.toUserSummary(userId);
  }

  /**
   * Professional profiles still waiting for a verification decision.
   *
   * A brand new professional is `UNVERIFIED`, and the schema default is
   * `UNVERIFIED` too, so a `PENDING`-only filter would hide every professional
   * who has just registered - the admin queue would be empty precisely when it
   * matters. Both "not looked at yet" states are therefore queued; `VERIFIED`
   * and `REJECTED` are decided and stay out.
   */
  async listVerificationRequests(): Promise<AdminVerificationRequestDto[]> {
    const profiles = await this.prisma.professionalProfile.findMany({
      where: {
        verification: {
          in: [
            PROFESSIONAL_VERIFICATION_STATUSES.UNVERIFIED,
            PROFESSIONAL_VERIFICATION_STATUSES.PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        businessName: true,
        bio: true,
        serviceArea: true,
        verification: true,
        verifiedAt: true,
        rejectionNote: true,
        yearsOfExperience: true,
        contactEmail: true,
        createdAt: true,
        user: { select: { fullName: true, phone: true, email: true, avatarUrl: true } },
        _count: { select: { bookings: true } },
      },
    });

    const servicesByUser = await this.servicesByUser(profiles.map((profile) => profile.userId));

    return profiles.map((profile) => {
      const services = servicesByUser.get(profile.userId) ?? [];
      return {
        profileId: profile.id,
        userId: profile.userId,
        fullName: profile.user.fullName,
        phone: profile.user.phone ?? '',
        email: profile.user.email,
        avatarUrl: profile.user.avatarUrl,
        businessName: profile.businessName,
        bio: profile.bio,
        serviceArea: profile.serviceArea,
        verification: profile.verification,
        verifiedAt: profile.verifiedAt?.toISOString() ?? null,
        rejectionNote: profile.rejectionNote,
        yearsOfExperience: profile.yearsOfExperience,
        contactEmail: profile.contactEmail,
        // The real services the professional has published, and the real number
        // of bookings they have taken. Both are read from the database; neither
        // is inferred from the other.
        services: services.map((service) => ({
          id: service.id,
          title: service.title,
          isActive: service.isActive,
        })),
        serviceCount: services.length,
        bookingCount: profile._count.bookings,
        submittedAt: profile.createdAt.toISOString(),
      };
    });
  }

  /** The published services of each professional, keyed by user id. */
  private async servicesByUser(
    userIds: string[],
  ): Promise<Map<string, Array<{ id: string; title: string; isActive: boolean }>>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.service.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true, ownerId: true, title: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const grouped = new Map<string, Array<{ id: string; title: string; isActive: boolean }>>();
    for (const row of rows) {
      const bucket = grouped.get(row.ownerId) ?? [];
      bucket.push({ id: row.id, title: row.title, isActive: row.isActive });
      grouped.set(row.ownerId, bucket);
    }
    return grouped;
  }

  /**
   * Approves or rejects a verification request.
   *
   * A rejection must carry a note: the professional is told why, so "rejected"
   * with no explanation is refused.
   */
  async decideVerification(
    adminId: string,
    profileId: string,
    decision: 'APPROVED' | 'REJECTED',
    note?: string,
  ): Promise<AdminVerificationRequestDto> {
    if (decision === 'REJECTED' && !note?.trim()) {
      // A validation problem, not a state conflict: the request is malformed
      // rather than too late to act on.
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'A rejection must explain why.',
      });
    }

    const next: ProfessionalVerificationStatus =
      decision === 'APPROVED'
        ? PROFESSIONAL_VERIFICATION_STATUSES.VERIFIED
        : PROFESSIONAL_VERIFICATION_STATUSES.REJECTED;

    const claimed = await this.prisma.professionalProfile.updateMany({
      where: {
        id: profileId,
        // Both undecided states, so a freshly registered professional can be
        // decided. A decided profile (VERIFIED/REJECTED) cannot be re-decided,
        // which is what stops a double click from overwriting an outcome.
        verification: {
          in: [
            PROFESSIONAL_VERIFICATION_STATUSES.UNVERIFIED,
            PROFESSIONAL_VERIFICATION_STATUSES.PENDING,
          ],
        },
      },
      data: {
        verification: next,
        ...(decision === 'APPROVED' ? { verifiedAt: new Date() } : {}),
        rejectionNote: decision === 'REJECTED' ? (note?.trim() ?? null) : null,
      },
    });
    // Only an undecided profile can be decided, so a double click cannot
    // re-verify an already-rejected professional or overwrite a decision.
    if (claimed.count !== 1) throw verificationNotPending();

    const profile = await this.prisma.professionalProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        bio: true,
        serviceArea: true,
        verification: true,
        verifiedAt: true,
        rejectionNote: true,
        yearsOfExperience: true,
        contactEmail: true,
        createdAt: true,
        user: { select: { fullName: true, phone: true, email: true, avatarUrl: true } },
        _count: { select: { bookings: true } },
      },
    });

    const services = (await this.servicesByUser([profile.userId])).get(profile.userId) ?? [];

    await this.audit.record({
      actorUserId: adminId,
      action:
        decision === 'APPROVED'
          ? ADMIN_AUDIT_ACTIONS.PROFESSIONAL_VERIFIED
          : ADMIN_AUDIT_ACTIONS.PROFESSIONAL_REJECTED,
      entityType: 'PROFESSIONAL_PROFILE',
      entityId: profileId,
      metadata: { decision, ...(note ? { note } : {}) },
    });

    await this.notifications.emit([
      {
        type: NOTIFICATION_TYPES.VERIFICATION_DECISION,
        userId: profile.userId,
        title:
          decision === 'APPROVED'
            ? 'Your professional profile is verified'
            : 'Your verification was not approved',
        body:
          decision === 'APPROVED'
            ? `${profile.businessName} is now verified.`
            : (note?.trim() ?? 'Your verification request was rejected.'),
        dedupeKey: `VERIFICATION:${profileId}:${decision}`,
      },
    ]);

    return {
      profileId: profile.id,
      userId: profile.userId,
      fullName: profile.user.fullName,
      phone: profile.user.phone ?? '',
      email: profile.user.email,
      avatarUrl: profile.user.avatarUrl,
      businessName: profile.businessName,
      bio: profile.bio,
      serviceArea: profile.serviceArea,
      verification: profile.verification,
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
      rejectionNote: profile.rejectionNote,
      yearsOfExperience: profile.yearsOfExperience,
      contactEmail: profile.contactEmail,
      services: services.map((service) => ({
        id: service.id,
        title: service.title,
        isActive: service.isActive,
      })),
      serviceCount: services.length,
      bookingCount: profile._count.bookings,
      submittedAt: profile.createdAt.toISOString(),
    };
  }

  async listAuditLog(): Promise<AdminAuditEntryDto[]> {
    return this.audit.list({ limit: 200 });
  }

  private async toUserSummary(userId: string): Promise<AdminUserSummaryDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) throw userNotFound();
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

function parseFilterDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: `The ${field} date is invalid.`,
    });
  }
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function userNotFound() {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'The requested user was not found.',
  });
}

function verificationNotPending() {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This professional has already had a verification decision.',
  });
}

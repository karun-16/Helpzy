import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_AUDIT_ACTIONS,
  API_ERROR_CODES,
  NOTIFICATION_TYPES,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  TERMINAL_REPORT_STATUSES,
} from '@helpzy/types';
import type { CreateReportDto, ResolveReportDto } from '@helpzy/validation';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The two people every report names, read in the same query as the report itself.
 *
 * A shared `include` rather than a repeated literal, because the list view and
 * the single-report view must ask for the same shape - a presenter that silently
 * drops a field is how a screen ends up rendering `undefined` for one row.
 */
const REPORT_PEOPLE = {
  reporter: { select: { id: true, fullName: true } },
  targetOwner: { select: { id: true, fullName: true } },
} as const;

type ReportWithPeople = Prisma.ReportGetPayload<{ include: typeof REPORT_PEOPLE }>;

/** What the admin triage screens read. */
type ReportPresentation = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string;
  status: string;
  resolutionNote: string | null;
  resolutionAction: string | null;
  createdAt: string;
  reporter: { id: string; fullName: string };
  targetOwner: { id: string; fullName: string };
  targetLabel: string;
};

/**
 * Filing and triaging reports.
 *
 * A report is a complaint, not a punishment. Two rules follow from that:
 *
 * 1. **The target is resolved before the row is written.** `targetId` is
 *    polymorphic, so the service looks it up in the table `targetType` names and
 *    refuses to file against something that does not exist. Without this a
 *    mistyped id would produce a report nobody can action.
 * 2. **The person reported is told.** Silently acting on a report would be a
 *    surprise; the notification gives the professional the chance to respond.
 *    A reporter is never notified about their own report.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async file(reporterId: string, input: CreateReportDto) {
    const target = await this.resolveTarget(input.targetType, input.targetId, reporterId);

    if (target.ownerId === reporterId) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'You cannot report yourself.',
      });
    }

    // A second live report about the same thing by the same person is noise in
    // the queue rather than new information.
    const existing = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: { notIn: [...TERMINAL_REPORT_STATUSES] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'You have already reported this. Our team is reviewing it.',
      });
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        targetOwnerId: target.ownerId,
        reason: input.reason,
        description: input.description,
        status: REPORT_STATUSES.OPEN,
      },
    });

    await this.notifications.emit([
      {
        userId: target.ownerId,
        type: NOTIFICATION_TYPES.REPORT_FILED_ABOUT_YOU,
        title: 'A report was filed about your listing',
        body: `${target.ownerName}, someone reported content on HELPZY. Our team will review it and you can respond from your account.`,
        // One notice per report, however many times it is retried.
        dedupeKey: `REPORT_FILED:${report.id}:${target.ownerId}`,
      },
    ]);

    return this.present(report.id);
  }

  /** Admin triage list. Defaults to the reports nobody has looked at yet. */
  async list(options: { status?: string; reason?: string; search?: string } = {}) {
    const search = options.search?.trim().slice(0, 80);

    const reports = await this.prisma.report.findMany({
      where: {
        ...(options.status && options.status !== 'ALL' ? { status: options.status as never } : {}),
        ...(options.reason && options.reason !== 'ALL' ? { reason: options.reason as never } : {}),
        ...(search
          ? {
              OR: [
                { description: { contains: search, mode: 'insensitive' as const } },
                { reporter: { fullName: { contains: search, mode: 'insensitive' as const } } },
                { targetOwner: { fullName: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: REPORT_PEOPLE,
    });

    /*
     * The people come from the one query above, and the target labels are fetched
     * in one query per target type rather than per row. Presenting each row on its
     * own cost two queries each, so a full 200-row queue cost ~400 round trips -
     * on the screen an admin refreshes repeatedly while triaging.
     */
    const labels = await this.describeTargets(reports);
    return reports.map((report) => this.toPresented(report, labels.get(report.id) ?? 'Unknown'));
  }

  async get(reportId: string) {
    const presented = await this.present(reportId);
    if (!presented) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That report was not found.',
      });
    }
    return presented;
  }

  /** Marks a report as actively being triaged, without deciding it. */
  async startReview(reportId: string) {
    const report = await this.requireReport(reportId);
    if (report.status === REPORT_STATUSES.UNDER_REVIEW) {
      return this.present(reportId);
    }
    if (this.isTerminal(report.status)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'This report has already been closed.',
      });
    }

    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: REPORT_STATUSES.UNDER_REVIEW },
    });

    return this.present(reportId);
  }

  /**
   * Closes a report with a note the reporter will be told about.
   *
   * `RESOLVED` means the report was upheld and something was done; `DISMISSED`
   * means it was not. Both require a note, because a report closed in silence
   * leaves the person who filed it with no answer at all.
   */
  async resolve(actorUserId: string, reportId: string, input: ResolveReportDto) {
    const report = await this.requireReport(reportId);

    if (this.isTerminal(report.status)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'This report has already been closed.',
      });
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: input.status,
        resolutionNote: input.resolutionNote,
        resolutionAction: input.resolutionAction ?? null,
        resolvedById: actorUserId,
        resolvedAt: new Date(),
      },
    });

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.REPORT_RESOLVED,
      entityType: 'REPORT',
      entityId: reportId,
      metadata: {
        from: report.status,
        to: input.status,
        reason: report.reason,
        targetType: report.targetType,
        targetId: report.targetId,
        ...(input.resolutionAction ? { resolutionAction: input.resolutionAction } : {}),
      },
    });

    // The reporter hears the outcome either way; a dismissal with no explanation
    // reads to them exactly like being ignored.
    await this.notifications.emit([
      {
        userId: report.reporterId,
        type: NOTIFICATION_TYPES.SYSTEM,
        title:
          input.status === REPORT_STATUSES.RESOLVED
            ? 'Your report was reviewed'
            : 'Your report was reviewed and closed',
        body: input.resolutionNote,
        dedupeKey: `REPORT_RESOLVED:${reportId}:${report.reporterId}`,
      },
    ]);

    return this.present(updated.id);
  }

  private isTerminal(status: string): boolean {
    return (TERMINAL_REPORT_STATUSES as readonly string[]).includes(status);
  }

  private async requireReport(reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That report was not found.',
      });
    }
    return report;
  }

  /**
   * Confirms the target exists and returns who owns it.
   *
   * A report about a listing or a booking is really a report about the person
   * behind it, so resolving the owner here is what lets the person reported be
   * notified and lets triage filter by owner.
   *
   * `reporterId` is required for a booking. A booking is not public: only its two
   * parties may complain about it, so accepting any id here would let a signed-in
   * user file a report against a stranger's booking - which notifies that
   * stranger's professional that they have been reported, and discloses the
   * booking reference through the target label. A listing and a professional
   * profile are browsable, so they need no such scope.
   */
  private async resolveTarget(
    targetType: string,
    targetId: string,
    reporterId: string,
  ): Promise<{ ownerId: string; ownerName: string }> {
    if (targetType === REPORT_TARGET_TYPES.PROFESSIONAL) {
      const profile = await this.prisma.professionalProfile.findUnique({
        where: { userId: targetId },
        select: { userId: true, user: { select: { fullName: true } } },
      });
      if (!profile) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'That professional could not be found.',
        });
      }
      return { ownerId: profile.userId, ownerName: profile.user.fullName };
    }

    if (targetType === REPORT_TARGET_TYPES.SERVICE) {
      const service = await this.prisma.service.findUnique({
        where: { id: targetId },
        select: { ownerId: true, owner: { select: { fullName: true } } },
      });
      if (!service) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'That service listing could not be found.',
        });
      }
      return { ownerId: service.ownerId, ownerName: service.owner.fullName };
    }

    if (targetType === REPORT_TARGET_TYPES.BOOKING) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: targetId },
        select: {
          customerId: true,
          customer: { select: { fullName: true } },
          professional: { select: { userId: true, user: { select: { fullName: true } } } },
        },
      });
      // A booking the reporter is not party to is reported as missing rather than
      // as forbidden: confirming it exists would itself leak information.
      if (!booking) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'That booking could not be found.',
        });
      }
      if (booking.customerId !== reporterId && booking.professional.userId !== reporterId) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'That booking could not be found.',
        });
      }
      // A booking has two parties and the reporter is one of them, so the one being
      // reported is whoever they are not. Naming the professional unconditionally
      // would misattribute the report whenever the reporter is the customer.
      return booking.customerId === reporterId
        ? { ownerId: booking.professional.userId, ownerName: booking.professional.user.fullName }
        : { ownerId: booking.customerId, ownerName: booking.customer.fullName };
    }

    const review = await this.prisma.review.findUnique({
      where: { id: targetId },
      select: { customerId: true, customer: { select: { fullName: true } } },
    });
    if (!review) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'That review could not be found.',
      });
    }
    return { ownerId: review.customerId, ownerName: review.customer.fullName };
  }

  /**
   * Builds the admin-facing view, resolving the label of whatever was reported.
   *
   * The label is resolved at read time rather than stored, so a report about a
   * listing still reads sensibly after that listing has been renamed or
   * withdrawn.
   */
  private async present(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: REPORT_PEOPLE,
    });
    if (!report) return null;

    const labels = await this.describeTargets([report]);
    return this.toPresented(report, labels.get(report.id) ?? 'Target unavailable');
  }

  /** The report row shape every presenter works from. */
  private toPresented(report: ReportWithPeople, targetLabel: string): ReportPresentation {
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      description: report.description,
      status: report.status,
      resolutionNote: report.resolutionNote ?? null,
      resolutionAction: report.resolutionAction ?? null,
      createdAt: report.createdAt.toISOString(),
      reporter: report.reporter,
      targetOwner: report.targetOwner,
      targetLabel,
    };
  }

  /**
   * Resolves the label of every report's target, in one query per target type.
   *
   * Returns a map keyed by report id so the caller keeps the row order it asked
   * for. A target type absent from a page issues no query at all, which is the
   * common case: a mixed queue costs three queries rather than one per row.
   */
  private async describeTargets(reports: ReportWithPeople[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    if (reports.length === 0) return labels;

    const byType = new Map<string, string[]>();
    for (const report of reports) {
      const ids = byType.get(report.targetType) ?? [];
      ids.push(report.targetId);
      byType.set(report.targetType, ids);
    }

    if (byType.has(REPORT_TARGET_TYPES.SERVICE)) {
      const services = await this.prisma.service.findMany({
        where: { id: { in: byType.get(REPORT_TARGET_TYPES.SERVICE) ?? [] } },
        select: { id: true, title: true },
      });
      this.assignTargetLabels(
        labels,
        reports,
        REPORT_TARGET_TYPES.SERVICE,
        new Map(services.map((service) => [service.id, `Listing: ${service.title}`])),
        'Listing (removed)',
      );
    }

    if (byType.has(REPORT_TARGET_TYPES.BOOKING)) {
      const bookings = await this.prisma.booking.findMany({
        where: { id: { in: byType.get(REPORT_TARGET_TYPES.BOOKING) ?? [] } },
        select: { id: true, reference: true },
      });
      this.assignTargetLabels(
        labels,
        reports,
        REPORT_TARGET_TYPES.BOOKING,
        new Map(bookings.map((booking) => [booking.id, `Booking ${booking.reference}`])),
        'Booking (removed)',
      );
    }

    if (byType.has(REPORT_TARGET_TYPES.REVIEW)) {
      const reviews = await this.prisma.review.findMany({
        where: { id: { in: byType.get(REPORT_TARGET_TYPES.REVIEW) ?? [] } },
        select: { id: true, rating: true },
      });
      this.assignTargetLabels(
        labels,
        reports,
        REPORT_TARGET_TYPES.REVIEW,
        new Map(reviews.map((review) => [review.id, `Review (${review.rating} stars)`])),
        'Review (removed)',
      );
    }

    return labels;
  }

  /** Copies the labels resolved for one target type onto the reports that named it. */
  private assignTargetLabels(
    labels: Map<string, string>,
    reports: ReportWithPeople[],
    targetType: string,
    resolved: Map<string, string>,
    missingLabel: string,
  ): void {
    for (const report of reports) {
      if (report.targetType !== targetType) continue;
      labels.set(report.id, resolved.get(report.targetId) ?? missingLabel);
    }
  }

  private async describeTarget(targetType: string, targetId: string): Promise<string> {
    if (targetType === REPORT_TARGET_TYPES.SERVICE) {
      const service = await this.prisma.service.findUnique({
        where: { id: targetId },
        select: { title: true },
      });
      return service ? `Listing: ${service.title}` : 'Listing (removed)';
    }
    if (targetType === REPORT_TARGET_TYPES.BOOKING) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: targetId },
        select: { reference: true },
      });
      return booking ? `Booking ${booking.reference}` : 'Booking (removed)';
    }
    if (targetType === REPORT_TARGET_TYPES.REVIEW) {
      const review = await this.prisma.review.findUnique({
        where: { id: targetId },
        select: { rating: true },
      });
      return review ? `Review (${review.rating} stars)` : 'Review (removed)';
    }
    return 'Professional profile';
  }
}

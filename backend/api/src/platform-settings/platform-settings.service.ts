import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ADMIN_AUDIT_ACTIONS, API_ERROR_CODES } from '@helpzy/types';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_PLATFORM_SETTINGS,
  MAINTENANCE_BLOCKED_ACTIONS,
  platformSettingsDocumentSchema,
  type MaintenanceBlockedAction,
  type PlatformSettingsDocument,
  type UpdatePlatformSettings,
} from '@helpzy/validation';

import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** How long a cached settings document is trusted before it is re-read. */
const CACHE_TTL_MS = 15_000;

/** The single row's fixed id; the column default enforces uniqueness in the DB. */
const SETTINGS_ROW_ID = 'MAIN';

/**
 * Platform settings: the one place an admin can change a rule without a deploy.
 *
 * Three decisions shape this service.
 *
 * **The document is validated on read, not trusted on write.** Settings decide
 * whether the platform accepts money, so a stored document that no longer parses -
 * a hand-edited row, a partial write, a future downgrade - must not silently
 * disable enforcement. Every read runs the schema, and anything that fails falls
 * back to the shipped defaults rather than propagating a broken shape.
 *
 * **Failing open on a read error is deliberate, and is the risky direction.** If the
 * database is briefly unavailable, the alternative is refusing every booking. The
 * defaults are the documented behaviour of the system, so serving them during an
 * outage is correct rather than merely convenient; the settings that guard money
 * (maintenance mode) are not defaults, which is why a failure to read them is
 * logged loudly and reported through `lastReadFailed` for the admin screen.
 *
 * **Enforcement lives here, not in the callers.** Callers ask questions
 * ("may this booking be placed at 09:00?") instead of reading fields and
 * re-deriving the rule. That is what keeps the admin form, the API and the
 * enforcement from drifting apart.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  private cached: { document: PlatformSettingsDocument; expiresAt: number } | null = null;

  /**
   * Set when the last read of the stored document failed and the defaults are
   * being served instead. The admin settings screen surfaces this, because
   * "your maintenance mode is off" is a dangerous thing to believe during an
   * outage.
   */
  private lastReadFailed = false;

  /**
   * True when the document just returned is a stand-in rather than the stored one.
   *
   * `current()` answers with the shipped defaults both when nothing has been saved
   * yet - which is normal and safe to write over - and when the stored document
   * could not be read or does not parse - which is neither. A write needs to tell
   * those apart: merging an admin's one-field patch over a stand-in saves the field
   * and silently resets every setting the admin did not mention, including
   * maintenance mode and what it blocks.
   */
  private currentIsStandIn = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
  ) {}

  /**
   * The current settings, from cache when fresh.
   *
   * Never throws: a settings read must not be able to take the marketplace down.
   */
  async current(): Promise<PlatformSettingsDocument> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.document;

    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { id: SETTINGS_ROW_ID },
      });
      this.lastReadFailed = false;
      // Nothing saved yet: the defaults are the stored document as far as anyone
      // can tell, so writing over them is a first save rather than a reset.
      this.currentIsStandIn = false;
      if (!row) return this.remember(this.cloneDefaults());

      /*
       * Re-validate rather than cast. `document` is untyped JSON as far as the
       * compiler is concerned, and a settings document that does not parse is a
       * rule set nobody can rely on - falling back to the documented defaults is
       * the only honest option.
       */
      const parsed = platformSettingsDocumentSchema.safeParse(row.document);
      if (!parsed.success) {
        this.logger.error(
          `Stored platform settings do not match the schema; serving defaults. Issues: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
        // Served so the marketplace keeps running, but never a base to write over.
        this.currentIsStandIn = true;
        return this.remember(this.cloneDefaults());
      }
      return this.remember(parsed.data);
    } catch (error) {
      this.lastReadFailed = true;
      this.currentIsStandIn = true;
      this.logger.error(
        `Could not read platform settings; serving defaults: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.remember(this.cloneDefaults());
    }
  }

  /** True when the stored document could not be read on the most recent call. */
  async isServingDefaultsBecauseReadFailed(): Promise<boolean> {
    return this.lastReadFailed;
  }

  /**
   * Applies an admin's changes to the stored document.
   *
   * The patch is merged over the current document and the *merged* result is
   * validated, so saving one section cannot produce a combination that the
   * whole-document schema would have refused. The before/after documents are both
   * recorded in the audit log, because "who changed what" needs the old value to
   * be answerable.
   */
  async update(actorUserId: string, patch: UpdatePlatformSettings) {
    const before = await this.current();

    /*
     * Refused rather than merged. `before` above is a stand-in whenever the stored
     * document could not be read or does not parse, and merging onto a stand-in
     * persists every untouched setting as its default: an admin who changes the
     * booking horizon during a database blip would also silently turn maintenance
     * mode off. Losing the change is recoverable; losing the settings around it is
     * not, so the write is the thing that gives way.
     */
    if (this.currentIsStandIn) {
      throw new ServiceUnavailableException({
        code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
        message:
          'The current settings could not be read, so nothing was changed. Please try again once they load.',
      });
    }

    const merged = platformSettingsDocumentSchema.safeParse({
      booking: { ...before.booking, ...(patch.booking ?? {}) },
      service: { ...before.service, ...(patch.service ?? {}) },
      platform: { ...before.platform, ...(patch.platform ?? {}) },
    });

    if (!merged.success) {
      /*
       * The reasons are in the message as well as in `details`, because the message
       * is the only part a client is guaranteed to show. "These settings cannot be
       * combined" tells an admin that something is wrong without telling them
       * *what*, and the person fixing it is the one who has to guess.
       */
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: [
          'These settings cannot be combined with the settings already in force.',
          ...merged.error.issues.map((issue) => issue.message),
        ].join(' '),
        details: merged.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const next = merged.data;
    const changedFields = this.changedFields(before, next);

    if (changedFields.length === 0) {
      // Re-saving identical values is a no-op, not an audit entry: an audit log
      // full of empty changes makes the real ones harder to find.
      return this.response(before, null);
    }

    const row = await this.prisma.platformSetting.upsert({
      where: { id: SETTINGS_ROW_ID },
      create: { id: SETTINGS_ROW_ID, document: next, updatedById: actorUserId },
      update: { document: next, updatedById: actorUserId },
      select: { updatedAt: true, updatedBy: { select: { fullName: true } } },
    });

    // Invalidate before auditing so a subsequent read cannot serve the old
    // document to a request that is already reacting to the change.
    this.cached = null;

    await this.audit.record({
      actorUserId,
      action: ADMIN_AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'PLATFORM_SETTING',
      entityId: SETTINGS_ROW_ID,
      metadata: {
        changedFields,
        before: this.diffValues(before, next, 'before'),
        after: this.diffValues(before, next, 'after'),
      },
    });

    return this.response(
      next,
      row.updatedBy?.fullName ?? null,
      row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    );
  }

  /** The full document plus the unauthenticated subset the app reads. */
  async response(
    document: PlatformSettingsDocument,
    updatedByName: string | null,
    updatedAt?: string,
  ) {
    let resolvedName = updatedByName;
    let resolvedAt = updatedAt;
    if (resolvedAt === undefined) {
      /*
       * Only the extra fields are read here, so a row that cannot be read at all
       * must not take the settings response down with it: the caller has already
       * been served the document, and failing here would turn a cosmetic lookup
       * into an outage. Absent metadata degrades to "just now".
       */
      const row = await this.prisma.platformSetting
        .findUnique({
          where: { id: SETTINGS_ROW_ID },
          select: { updatedAt: true, updatedBy: { select: { fullName: true } } },
        })
        .catch(() => null);
      resolvedAt = row?.updatedAt?.toISOString?.() ?? new Date().toISOString();
      resolvedName = resolvedName ?? row?.updatedBy?.fullName ?? null;
    }

    return {
      settings: document,
      publicView: {
        maintenanceMode: document.platform.maintenanceMode,
        maintenanceMessage: document.platform.maintenanceMessage,
        announcementEnabled: document.platform.announcementEnabled,
        announcementMessage: document.platform.announcementMessage,
        announcementSeverity: document.platform.announcementSeverity,
        supportEmail: document.platform.supportEmail,
        supportPhone: document.platform.supportPhone,
        booking: {
          availability: document.booking.availability,
          minimumLeadMinutes: document.booking.minimumLeadMinutes,
          maximumLeadDays: document.booking.maximumLeadDays,
        },
      },
      updatedAt: resolvedAt,
      updatedByName: resolvedName,
      // Not part of the schema: the admin screen shows this as a warning banner
      // so a broken read is never mistaken for "maintenance is off".
      servingDefaultsBecauseReadFailed: this.lastReadFailed,
    };
  }

  // ---------------------------------------------------------------- enforcement

  /**
   * Refuses an action that maintenance mode is blocking.
   *
   * Throws `ServiceUnavailableException` rather than `BadRequestException` on
   * purpose: 503 is what a client, a load balancer and a monitoring system all
   * already understand as "try again later", which is exactly what maintenance
   * means. The settings carry their own message so the user is told what is
   * happening rather than shown a bare 503.
   */
  async assertNotBlocked(action: MaintenanceBlockedAction): Promise<void> {
    const { platform } = await this.current();
    if (!platform.maintenanceMode) return;
    if (!platform.maintenanceBlockedActions.includes(action)) return;

    throw new ServiceUnavailableException({
      code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
      message:
        platform.maintenanceMessage ||
        'HELPZY is carrying out maintenance at the moment. Please try again shortly.',
    });
  }

  /**
   * Checks a proposed booking time against the lead time and the horizon.
   *
   * Both bounds are reported together, because telling a customer only "too soon"
   * when the real problem is "too far ahead" is how a date picker becomes
   * unusable.
   */
  async assertBookableAt(scheduledStart: Date, now = new Date()): Promise<void> {
    const { booking } = await this.current();

    if (booking.availability !== 'OPEN') {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Bookings are temporarily closed. Please check back shortly.',
      });
    }

    const leadMs = booking.minimumLeadMinutes * 60_000;
    if (scheduledStart.getTime() < now.getTime() + leadMs) {
      const hours = Math.max(1, Math.round(leadMs / 3_600_000));
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message:
          hours <= 1
            ? 'Choose a time at least an hour from now.'
            : `Choose a time at least ${hours} hours from now.`,
      });
    }

    if (booking.maximumLeadDays > 0) {
      const horizon = now.getTime() + booking.maximumLeadDays * 86_400_000;
      if (scheduledStart.getTime() > horizon) {
        throw new BadRequestException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `Bookings can be made up to ${booking.maximumLeadDays} days ahead.`,
        });
      }
    }
  }

  /**
   * Refuses a cancellation made inside the configured window.
   *
   * `existingStart` is passed rather than read here so the caller can pass the
   * value it already loaded; a second read could disagree with the one the caller
   * acted on.
   */
  async assertCancellable(existingStart: Date, now = new Date()): Promise<void> {
    const { booking } = await this.current();
    if (booking.cancellationWindowHours === 0) return;

    const cutoff = now.getTime() + booking.cancellationWindowHours * 3_600_000;
    if (existingStart.getTime() <= cutoff) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: `Bookings can only be cancelled more than ${booking.cancellationWindowHours} hours before the scheduled time.`,
      });
    }
  }

  /**
   * Checks a proposed reschedule time.
   *
   * A reschedule is checked against its own horizon rather than the booking one,
   * because moving an existing booking is not the same act as creating a new one:
   * the booking already exists and both parties have committed to it.
   *
   * Every refusal here is a `ConflictException`, not a `BadRequestException`. That
   * is the contract `RescheduleService` already had for these same conditions, and
   * the difference is meaningful to a client: 409 says "the booking's schedule is
   * the problem, look again and offer a different time", whereas 400 would tell the
   * user their request was malformed, which it was not.
   */
  async assertReschedulableTo(proposedStart: Date, now = new Date()): Promise<void> {
    const { booking } = await this.current();
    if (!booking.reschedulingEnabled) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Rescheduling is currently unavailable for this booking.',
      });
    }
    if (proposedStart.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Choose a future date and time.',
      });
    }
    if (booking.rescheduleMaximumLeadDays > 0) {
      const horizon = now.getTime() + booking.rescheduleMaximumLeadDays * 86_400_000;
      if (proposedStart.getTime() > horizon) {
        throw new ConflictException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `A booking cannot be moved beyond ${booking.rescheduleMaximumLeadDays} days from now.`,
        });
      }
    }
  }

  /**
   * Checks a service's duration and price against the configured bounds.
   *
   * Settings can only tighten the per-field limits the request schema already
   * enforces. That asymmetry is the point: an admin can raise the minimum price,
   * but no settings combination can make the API accept something the schema
   * refuses, so the hard outer bound stays authoritative.
   */
  async assertServiceWithinLimits(input: {
    durationMinutes?: number | null;
    priceAmount?: number | null;
  }): Promise<void> {
    const { service } = await this.current();

    if (input.durationMinutes != null) {
      if (input.durationMinutes < service.minimumDurationMinutes) {
        throw new BadRequestException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `Services must run for at least ${service.minimumDurationMinutes} minutes.`,
        });
      }
      if (input.durationMinutes > service.maximumDurationMinutes) {
        throw new BadRequestException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `Services cannot run for longer than ${service.maximumDurationMinutes} minutes.`,
        });
      }
    }

    if (input.priceAmount != null) {
      if (input.priceAmount < service.minimumPriceAmount) {
        throw new BadRequestException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `Services must be priced at least ₹${service.minimumPriceAmount.toLocaleString('en-IN')}.`,
        });
      }
      if (input.priceAmount > service.maximumPriceAmount) {
        throw new BadRequestException({
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: `Services cannot be priced above ₹${service.maximumPriceAmount.toLocaleString('en-IN')}.`,
        });
      }
    }
  }

  /** Whether a newly created service must wait for an admin before it is listed. */
  async requiresModerationBeforePublish(): Promise<boolean> {
    const { service } = await this.current();
    return service.requireModerationBeforePublish;
  }

  // ------------------------------------------------------------------- helpers

  private remember(document: PlatformSettingsDocument): PlatformSettingsDocument {
    this.cached = { document, expiresAt: Date.now() + CACHE_TTL_MS };
    return document;
  }

  /** A deep copy, so a cached default can never be mutated by a caller. */
  private cloneDefaults(): PlatformSettingsDocument {
    return structuredClone(DEFAULT_PLATFORM_SETTINGS);
  }

  /**
   * The dotted paths whose values differ, e.g. `booking.minimumLeadMinutes`.
   *
   * Returned for the audit log rather than the whole before/after pair, because
   * the useful question later is "which setting did they touch".
   */
  private changedFields(
    before: PlatformSettingsDocument,
    after: PlatformSettingsDocument,
  ): string[] {
    const changed: string[] = [];
    for (const section of ['booking', 'service', 'platform'] as const) {
      const a = before[section] as Record<string, unknown>;
      const b = after[section] as Record<string, unknown>;
      for (const key of Object.keys(b)) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
          changed.push(`${section}.${key}`);
        }
      }
    }
    return changed;
  }

  /**
   * Only the changed fields' old and new values, for a readable audit entry.
   *
   * Typed as Prisma's JSON input rather than `Record<string, unknown>`: the values
   * come from a document that has already passed the settings schema, so they are
   * JSON-compatible, but Prisma's structural type does not narrow `unknown` to
   * that and needs the assertion stated once, here, rather than at the call site.
   */
  private diffValues(
    before: PlatformSettingsDocument,
    after: PlatformSettingsDocument,
    side: 'before' | 'after',
  ): Prisma.InputJsonObject {
    const source = side === 'before' ? before : after;
    const other = side === 'before' ? after : before;
    const values: Record<string, Prisma.InputJsonValue> = {};
    for (const section of ['booking', 'service', 'platform'] as const) {
      const a = source[section] as Record<string, unknown>;
      const b = other[section] as Record<string, unknown>;
      for (const key of Object.keys(b)) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
          values[`${section}.${key}`] = a[key] as Prisma.InputJsonValue;
        }
      }
    }
    return values;
  }

  /**
   * Drops the cache. Exposed for tests and for the rare case where an operator
   * edits the row directly and needs the change picked up without waiting for the
   * TTL.
   */
  invalidate(): void {
    this.cached = null;
  }
}

/** Re-exported so callers do not have to reach into the validation package. */
export { MAINTENANCE_BLOCKED_ACTIONS };
export type { PlatformSettingsDocument, MaintenanceBlockedAction };

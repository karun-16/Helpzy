import { z } from 'zod';

/**
 * Platform settings: the rules an admin can change while the system is running.
 *
 * This file is the single definition of the settings document. The API validates
 * every write against it, the admin app builds its form from it, and the
 * enforcement code reads the typed result. That is deliberate: a rule enforced in
 * the backend but described in the admin UI by hand will eventually disagree with
 * itself, and the disagreement will always favour whichever side nobody tested.
 *
 * Cross-field rules live in `superRefine` rather than as separate per-field checks,
 * so a contradictory combination is refused as a *combination* - with a message
 * naming both fields - instead of failing on whichever one happened to be checked
 * first.
 */

/** How prominent an announcement is in the app. */
export const ANNOUNCEMENT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;

/** Whether booking creation is open to customers. */
export const BOOKING_AVAILABILITY = ['OPEN', 'CLOSED'] as const;

export const announcementSeveritySchema = z.enum(ANNOUNCEMENT_SEVERITIES);
export const bookingAvailabilitySchema = z.enum(BOOKING_AVAILABILITY);

/**
 * The same field schemas with their `.default()` removed.
 *
 * Needed because `schema.partial()` is not what it looks like on a schema whose
 * fields have defaults: Zod wraps each one as `ZodDefault<ZodOptional<...>>`, so an
 * *absent* key still comes back filled in with its default. Patching
 * `{ minimumLeadMinutes }` would therefore also send every other field of that
 * section at its default value, and the service - which merges the patch over the
 * stored document - would overwrite settings the admin never mentioned. The
 * symptom is a settings screen where saving one field silently resets the rest,
 * which is exactly the failure mode this file exists to prevent.
 */
function stripDefaults(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [
      key,
      schema instanceof z.ZodDefault ? schema.removeDefault() : schema,
    ]),
  );
}

/**
 * Booking rules.
 *
 * `minimumLeadMinutes` and `maximumLeadDays` bound how far ahead a booking may be
 * placed. Both are about *new* bookings: an existing booking is never invalidated
 * by a later settings change, because withdrawing a service someone already booked
 * is a different decision from refusing new ones.
 */
/**
 * The field shapes, without the cross-field rules.
 *
 * Split out because Zod refuses `.partial()` on a schema that carries a
 * refinement, and the admin app needs to send one section at a time. The
 * refinement still runs - just against the *merged* document in the service,
 * which is the stricter place to run it: saving the booking section alone cannot
 * then produce a combination the whole-document schema would have refused.
 *
 * `strict` rather than the default strip-unknown behaviour, because silently
 * dropping a misspelled key is how a setting appears to save and then does
 * nothing. Refusing it tells the caller the field does not exist; a *stored*
 * document that carries an unknown key fails the same check and falls back to
 * the defaults, so a renamed setting cannot keep taking effect under its old
 * name either.
 */
const bookingSettingsFields = z
  .object({
    availability: bookingAvailabilitySchema.default('OPEN'),
    /** 0 means "same moment is allowed", which is useful for testing and demos. */
    minimumLeadMinutes: z.number().int().min(0).max(43_200).default(0),
    /** 0 removes the horizon entirely, so bookings can be placed any far ahead. */
    maximumLeadDays: z.number().int().min(0).max(730).default(0),
    /**
     * How long before the scheduled start a customer may still cancel. 0 means no
     * window is enforced here; the professional's own status rules still apply.
     */
    cancellationWindowHours: z.number().int().min(0).max(720).default(0),
    /**
     * Whether either party may propose a different time. Turning this off hides
     * the feature rather than deleting proposals already in flight.
     */
    reschedulingEnabled: z.boolean().default(true),
    /** A reschedule cannot move a booking later than this; 0 means no limit. */
    rescheduleMaximumLeadDays: z.number().int().min(0).max(730).default(0),
  })
  .strict();

export const bookingSettingsSchema = bookingSettingsFields.superRefine((value, ctx) => {
  /*
   * A lead time larger than the whole horizon would make every date invalid, so
   * the combination is refused rather than saved and discovered at booking time.
   */
  const horizonMinutes = value.maximumLeadDays * 24 * 60;
  if (value.maximumLeadDays > 0 && value.minimumLeadMinutes > horizonMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maximumLeadDays'],
      message:
        'The furthest a booking may be placed must be beyond the shortest notice it requires, otherwise no date is ever valid.',
    });
  }
  if (
    value.rescheduleMaximumLeadDays > 0 &&
    value.rescheduleMaximumLeadDays < value.maximumLeadDays
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rescheduleMaximumLeadDays'],
      message:
        'A rescheduled booking cannot be limited to a nearer date than a new booking. Otherwise a booking could be created for a date it could then never be moved to.',
    });
  }
});

/**
 * Service rules.
 *
 * These bound what a professional may publish. The existing per-field limits in
 * `createProfessionalServiceSchema` are the hard outer bound; these settings can
 * only tighten them, never loosen them past what the API already refuses. That
 * relationship is enforced in the service, not here, because it compares two
 * schemas rather than two fields of one.
 */
const serviceSettingsFields = z
  .object({
    minimumDurationMinutes: z.number().int().min(15).max(1440).default(30),
    maximumDurationMinutes: z.number().int().min(15).max(1440).default(480),
    minimumPriceAmount: z.number().min(0).max(10_000_000).default(0),
    maximumPriceAmount: z.number().min(1).max(10_000_000).default(100_000),
    /** Whether a new listing stays invisible until an admin approves it. */
    requireModerationBeforePublish: z.boolean().default(false),
    /**
     * Whether only `VERIFIED` professionals appear in public discovery.
     *
     * Defaults to **off**, which is the marketplace's long-standing behaviour:
     * listing is gated on the professional being active and having an eligible
     * service, and verification is shown as a badge rather than used as a gate.
     * Turning this on is a deliberate policy change by an operator, so it is a
     * setting rather than a hardcoded rule - and because it only affects *public
     * listing*, it never hides a professional from an existing booking or from the
     * admin's own review queues.
     *
     * It deliberately does not gate accepting a booking. An operator who wants that
     * too needs the separate rule rather than discovering it here.
     */
    requireVerifiedForDiscovery: z.boolean().default(false),
  })
  .strict();

export const serviceSettingsSchema = serviceSettingsFields.superRefine((value, ctx) => {
  if (value.minimumDurationMinutes > value.maximumDurationMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minimumDurationMinutes'],
      message: 'The shortest allowed job cannot be longer than the longest allowed job.',
    });
  }
  if (value.minimumPriceAmount > value.maximumPriceAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minimumPriceAmount'],
      message: 'The lowest allowed price cannot be above the highest allowed price.',
    });
  }
});

/**
 * Platform controls.
 *
 * `maintenanceMode` blocks the actions named in `maintenanceBlockedActions`
 * rather than shutting the app down. A read-only marketplace during maintenance is
 * more useful to customers than an error page, and an admin who turns maintenance
 * on during an incident does not want to discover that they have also just
 * prevented themselves from reading the audit log.
 */
export const MAINTENANCE_BLOCKED_ACTIONS = [
  'CREATE_BOOKING',
  'CREATE_SERVICE',
  'START_PAYMENT',
] as const;

const platformSettingsFields = z
  .object({
    maintenanceMode: z.boolean().default(false),
    /** Shown instead of a generic error whenever a blocked action is attempted. */
    maintenanceMessage: z.string().trim().max(500).default(''),
    maintenanceBlockedActions: z
      .array(z.enum(MAINTENANCE_BLOCKED_ACTIONS))
      .default([...MAINTENANCE_BLOCKED_ACTIONS]),
    announcementEnabled: z.boolean().default(false),
    announcementMessage: z.string().trim().max(500).default(''),
    announcementSeverity: announcementSeveritySchema.default('INFO'),
    /**
     * Empty means "not published". A plain `.email()` would reject the empty string,
     * which is the default - so the schema would refuse its own default and no
     * settings save could ever succeed.
     */
    supportEmail: z
      .string()
      .trim()
      .refine((value) => value === '' || z.string().email().safeParse(value).success, {
        message: 'Enter a valid support email address, or leave it empty.',
      })
      .default(''),
    supportPhone: z.string().trim().max(20).default(''),
    /**
     * Whether transactional notifications are delivered at all. Off means booking
     * and payment records still update correctly - only the notice is suppressed, so
     * turning this on during a notification outage does not affect business data.
     */
    notificationsEnabled: z.boolean().default(true),
  })
  .strict();

export const platformSettingsSchema = platformSettingsFields.superRefine((value, ctx) => {
  // An announcement nobody will see is a misconfiguration, not a harmless no-op.
  if (value.announcementEnabled && value.announcementMessage.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['announcementMessage'],
      message: 'Write the announcement text, or turn announcements off.',
    });
  }
  // Maintenance that blocks nothing is the same misconfiguration: it shows a
  // scary banner and then lets everything through.
  if (value.maintenanceMode && value.maintenanceBlockedActions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maintenanceBlockedActions'],
      message:
        'Maintenance mode is on but nothing is blocked. Choose at least one action to block, or turn maintenance mode off.',
    });
  }
  if (value.maintenanceMode && value.maintenanceMessage.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maintenanceMessage'],
      message: 'Say what is happening. This text is shown to anyone whose action is blocked.',
    });
  }
});

/** The complete settings document. */
export const platformSettingsDocumentSchema = z
  .object({
    booking: bookingSettingsSchema,
    service: serviceSettingsSchema,
    platform: platformSettingsSchema,
  })
  .strict();

/**
 * The patch shapes: every field optional, and no field carrying a default.
 *
 * Defaults stay on the section schemas, where they earn their keep - a stored
 * document written before a setting existed still parses, and fills in the new
 * field, rather than the whole document being thrown away and an admin silently
 * losing every other value they had configured. A *patch* needs the opposite
 * behaviour: it must say only what it changes.
 */
const bookingPatchFields = z.object(stripDefaults(bookingSettingsFields.shape)).partial().strict();
const servicePatchFields = z.object(stripDefaults(serviceSettingsFields.shape)).partial().strict();
const platformPatchFields = z
  .object(stripDefaults(platformSettingsFields.shape))
  .partial()
  .strict();

/**
 * What an admin may change.
 *
 * Every field is optional so the admin app can save one section without
 * resending the others, and the service merges over the current document. The
 * cross-field rules still run against the *merged* result, so saving the booking
 * section alone cannot create a combination the whole-document schema would have
 * refused.
 */
export const updatePlatformSettingsSchema = z
  .object({
    booking: bookingPatchFields.optional(),
    service: servicePatchFields.optional(),
    platform: platformPatchFields.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one setting to change.');

/**
 * The settings as the app needs them.
 *
 * Two views of the same document:
 *
 * - `settings` is the whole thing, for the admin form.
 * - `publicView` is what an unauthenticated customer needs in order to read a
 *   maintenance banner: the platform section plus the two booking bounds the app
 *   uses to explain *why* a date is not offered. Enforcement values are included
 *   deliberately - the alternative is the app hiding a date with no explanation,
 *   which reads as a bug.
 */
export const platformSettingsResponseSchema = z.object({
  settings: platformSettingsDocumentSchema,
  publicView: z.object({
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string(),
    announcementEnabled: z.boolean(),
    announcementMessage: z.string(),
    announcementSeverity: announcementSeveritySchema,
    supportEmail: z.string(),
    supportPhone: z.string(),
    booking: z.object({
      availability: bookingAvailabilitySchema,
      minimumLeadMinutes: z.number().int(),
      maximumLeadDays: z.number().int(),
    }),
  }),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
  /**
   * True when the stored document could not be read and the defaults are being
   * served instead.
   *
   * Surfaced rather than swallowed because "maintenance mode is off" is exactly the
   * belief that must not be trusted while the settings store is unreachable. The
   * admin screen shows it as a warning; the public endpoint does not expose it,
   * since there is nothing a visitor could usefully do about it.
   */
  servingDefaultsBecauseReadFailed: z.boolean(),
});

export type AnnouncementSeverity = z.infer<typeof announcementSeveritySchema>;
export type BookingAvailability = z.infer<typeof bookingAvailabilitySchema>;
/**
 * The unauthenticated slice, as returned by `GET /platform/settings`.
 *
 * A separate schema from the admin response so that adding a field to the admin
 * document cannot accidentally make it public: the app has to opt in here, field
 * by field, for something to reach an unauthenticated caller.
 */
export const publicPlatformSettingsSchema = z.object({
  publicView: z.object({
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string(),
    announcementEnabled: z.boolean(),
    announcementMessage: z.string(),
    announcementSeverity: announcementSeveritySchema,
    supportEmail: z.string(),
    supportPhone: z.string(),
    booking: z.object({
      availability: bookingAvailabilitySchema,
      minimumLeadMinutes: z.number().int(),
      maximumLeadDays: z.number().int(),
    }),
  }),
});

export type BookingSettings = z.infer<typeof bookingSettingsSchema>;
export type ServiceSettings = z.infer<typeof serviceSettingsSchema>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type PlatformSettingsDocument = z.infer<typeof platformSettingsDocumentSchema>;
export type UpdatePlatformSettings = z.infer<typeof updatePlatformSettingsSchema>;
export type PlatformSettingsResponse = z.infer<typeof platformSettingsResponseSchema>;
export type MaintenanceBlockedAction = (typeof MAINTENANCE_BLOCKED_ACTIONS)[number];

/**
 * The shipped defaults.
 *
 * These are also what the API serves when no row exists yet, and what it falls
 * back to if the stored document is unreadable. They are therefore the values the
 * whole system is specified against, and they must keep behaving exactly as the
 * system behaved before settings existed.
 *
 * **Every bound here is 0, and that is the point.** Before settings existed the
 * system enforced exactly one temporal rule: a booking had to be in the future. A
 * minimum lead time, a booking horizon, a cancellation notice window and a
 * reschedule horizon were all *new* rules. Shipping them enabled would mean that
 * upgrading the platform silently started rejecting bookings and cancellations that
 * had always been accepted - a customer who could book tomorrow's slot yesterday
 * cannot be told afterwards that the change was "just a default".
 *
 * So the rules ship switched off and an admin turns them on deliberately. 0 is the
 * honest encoding of "this restriction is not in force", and every field documents
 * it.
 *
 * The service and duration bounds are the exception: they are not 0, because they
 * are strictly *tighter* than the per-field limits the request schema already
 * enforced (15-1440 minutes, up to 10,000,000). Tightening is the only direction an
 * admin may move them, so a default in that range cannot widen what the API already
 * refuses.
 */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsDocument = {
  booking: {
    availability: BOOKING_AVAILABILITY[0],
    minimumLeadMinutes: 0,
    maximumLeadDays: 0,
    cancellationWindowHours: 0,
    reschedulingEnabled: true,
    rescheduleMaximumLeadDays: 0,
  },
  service: {
    minimumDurationMinutes: 30,
    maximumDurationMinutes: 480,
    minimumPriceAmount: 0,
    maximumPriceAmount: 100_000,
    requireModerationBeforePublish: false,
    requireVerifiedForDiscovery: false,
  },
  platform: {
    maintenanceMode: false,
    maintenanceMessage: '',
    maintenanceBlockedActions: [...MAINTENANCE_BLOCKED_ACTIONS],
    announcementEnabled: false,
    announcementMessage: '',
    announcementSeverity: 'INFO',
    supportEmail: '',
    supportPhone: '',
    notificationsEnabled: true,
  },
};

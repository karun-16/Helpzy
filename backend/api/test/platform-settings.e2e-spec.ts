import { DEFAULT_PLATFORM_SETTINGS } from '@helpzy/validation';

import {
  ADMIN_ID,
  createBookingFlowsHarness,
  hoursFromNow,
  type Harness,
} from './harness/booking-flows.harness';
import { PlatformSettingsService } from '../src/platform-settings/platform-settings.service';

/**
 * Admin platform settings: persistence, enforcement and access control.
 *
 * Written around the properties that matter rather than the shape of each
 * response. A settings system that stores a number correctly but enforces it
 * nowhere is not a settings system, so the majority of these tests make a change
 * through the admin API and then prove a *different* endpoint honours it. The
 * fail-safe behaviour - a document that cannot be read serves defaults instead of
 * breaking the marketplace - is tested explicitly rather than left to chance.
 */
describe('Platform settings (e2e)', () => {
  let harness: Harness;

  const api = () => harness.api();
  const as = (role: Parameters<Harness['as']>[0]) => harness.as(role);
  const modelMethod = (name: string, method: string) => harness.modelMethod(name, method);

  /** The seeded booking's id, which every booking-scoped route needs. */
  const bookingId = () => harness.state.booking!.id as string;

  const SERVICE_ID = 'b8000000-0000-4000-8000-000000000001';
  const PROFESSIONAL_OWNER_ID = 'b2000000-0000-4000-8000-000000000001';

  /**
   * A request that passes the booking schema.
   *
   * The settings rules are enforced *after* the request is parsed, so a request
   * the schema refuses never reaches them - and an enforcement test that only ever
   * proved "400, wrong message" would pass for the wrong reason. These payloads
   * are valid so that the message that comes back is the settings rule's, and the
   * ids and address are the ones the harness's doubles answer to.
   */
  const bookingRequest = (hoursFromNowBy: number) => ({
    professionalId: PROFESSIONAL_OWNER_ID,
    serviceId: SERVICE_ID,
    scheduledStart: hoursFromNow(hoursFromNowBy).toISOString(),
    address: {
      label: 'Home',
      line1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    },
  });

  beforeAll(async () => {
    harness = await createBookingFlowsHarness();
  });

  beforeEach(() => {
    // Both halves matter: the settings service caches for 15s, so clearing only
    // the row would let one test's settings leak into the next.
    harness.resetSettings();
    modelMethod('platformSetting', 'upsert').mockClear();
    harness.auditLog.length = 0;
    harness.notifications.length = 0;
    /*
     * The doubles are process-wide, so a test that cancels a booking or leaves a
     * reschedule proposal behind would otherwise decide the outcome of the next
     * one - a proposal in particular short-circuits the very check under test.
     */
    harness.state.booking = harness.baseBooking();
    harness.state.payment = null;
    harness.state.proposal = null;
    // A creatable booking, so a rule that *allows* the request really is allowed.
    harness.enableBookableService();
    modelMethod('booking', 'create').mockClear();
    modelMethod('service', 'create').mockClear();
  });

  /** Saves a patch as the admin and returns the resulting settings document. */
  const save = async (patch: Record<string, unknown>) => {
    const response = await api()
      .patch('/api/v1/admin/settings')
      .set(as('ADMIN'))
      .send(patch)
      .expect(200);
    return response.body.data;
  };

  describe('reading settings', () => {
    it('serves the documented defaults when nothing has been saved', async () => {
      const response = await api().get('/api/v1/admin/settings').set(as('ADMIN')).expect(200);

      expect(response.body.data.settings).toEqual(DEFAULT_PLATFORM_SETTINGS);
    });

    it('reports that no read failed when the store is reachable', async () => {
      const response = await api().get('/api/v1/admin/settings').set(as('ADMIN')).expect(200);
      expect(response.body.data.servingDefaultsBecauseReadFailed).toBe(false);
    });

    it('refuses anonymous and non-admin callers', async () => {
      await api().get('/api/v1/admin/settings').expect(401);
      await api().get('/api/v1/admin/settings').set(as('CUSTOMER')).expect(403);
      await api().get('/api/v1/admin/settings').set(as('PROFESSIONAL')).expect(403);
    });

    it('refuses anonymous and non-admin writers', async () => {
      await api().patch('/api/v1/admin/settings').send({ booking: {} }).expect(401);
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('CUSTOMER'))
        .send({ booking: { minimumLeadMinutes: 5 } })
        .expect(403);
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('PROFESSIONAL'))
        .send({ booking: { minimumLeadMinutes: 5 } })
        .expect(403);
    });
  });

  describe('the public view', () => {
    it('is readable without signing in, so a visitor sees the announcement', async () => {
      const response = await api().get('/api/v1/platform/settings').expect(200);
      expect(response.body.data.publicView).toMatchObject({
        maintenanceMode: false,
        announcementEnabled: false,
      });
    });

    it('never exposes the whole document to an anonymous caller', async () => {
      const response = await api().get('/api/v1/platform/settings').expect(200);

      // The notification and moderation switches are operational internals; a
      // visitor has no reason to learn whether they are on.
      expect(response.body.data.publicView).not.toHaveProperty('notificationsEnabled');
      expect(response.body.data).not.toHaveProperty('settings');
    });

    it('does not leak the read-failure flag to the public', async () => {
      const response = await api().get('/api/v1/platform/settings').expect(200);
      expect(response.body.data).not.toHaveProperty('servingDefaultsBecauseReadFailed');
    });
  });

  describe('persistence', () => {
    it('stores the change and returns it', async () => {
      const data = await save({ booking: { minimumLeadMinutes: 180 } });
      expect(data.settings.booking.minimumLeadMinutes).toBe(180);
    });

    it('leaves untouched sections exactly as they were', async () => {
      const data = await save({ booking: { minimumLeadMinutes: 180 } });

      // Saving one section must not reset the others - that is the failure mode of
      // a settings form that always PUTs the whole document.
      expect(data.settings.booking.maximumLeadDays).toBe(
        DEFAULT_PLATFORM_SETTINGS.booking.maximumLeadDays,
      );
      expect(data.settings.service).toEqual(DEFAULT_PLATFORM_SETTINGS.service);
      expect(data.settings.platform).toEqual(DEFAULT_PLATFORM_SETTINGS.platform);
    });

    it('upserts rather than creating a second row', async () => {
      await save({ booking: { minimumLeadMinutes: 120 } });
      expect(modelMethod('platformSetting', 'upsert')).toHaveBeenCalledTimes(1);
      expect(modelMethod('platformSetting', 'upsert').mock.calls[0]?.[0].where).toEqual({
        id: 'MAIN',
      });
    });

    it('records who made the change', async () => {
      const data = await save({ booking: { minimumLeadMinutes: 120 } });
      expect(data.updatedByName).toBeTruthy();
    });

    it('ignores an empty patch rather than writing a no-op', async () => {
      await api().patch('/api/v1/admin/settings').set(as('ADMIN')).send({}).expect(400);
      expect(modelMethod('platformSetting', 'upsert')).not.toHaveBeenCalled();
    });
  });

  describe('audit trail', () => {
    it('records a settings change against the admin who made it', async () => {
      await save({ booking: { minimumLeadMinutes: 240 } });

      const entry = harness.auditLog.find((row) => row.action === 'SETTINGS_CHANGED');
      expect(entry).toMatchObject({
        actorUserId: ADMIN_ID,
        action: 'SETTINGS_CHANGED',
        entityType: 'PLATFORM_SETTING',
        entityId: 'MAIN',
      });
    });

    it('names the fields that changed and both values', async () => {
      await save({ booking: { minimumLeadMinutes: 240 } });

      const entry = harness.auditLog.find((row) => row.action === 'SETTINGS_CHANGED');
      expect(entry?.metadata).toMatchObject({
        changedFields: ['booking.minimumLeadMinutes'],
        before: { 'booking.minimumLeadMinutes': 0 },
        after: { 'booking.minimumLeadMinutes': 240 },
      });
    });

    it('does not record anything when the saved values are unchanged', async () => {
      // Defaults are already the current values, so this is a no-op save.
      await save({
        booking: { minimumLeadMinutes: DEFAULT_PLATFORM_SETTINGS.booking.minimumLeadMinutes },
      });

      expect(harness.auditLog.some((row) => row.action === 'SETTINGS_CHANGED')).toBe(false);
    });
  });

  describe('validation', () => {
    it('refuses a lead time longer than the whole booking horizon', async () => {
      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { minimumLeadMinutes: 4320, maximumLeadDays: 1 } })
        .expect(400);

      // The combination would leave no valid date at all, so it is refused as a
      // pair rather than discovered by a customer.
      expect(response.body.error.message).toContain('no date is ever valid');
    });

    it('refuses a shortest job longer than the longest job', async () => {
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ service: { minimumDurationMinutes: 600, maximumDurationMinutes: 120 } })
        .expect(400);
    });

    it('refuses a lowest price above the highest price', async () => {
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ service: { minimumPriceAmount: 5000, maximumPriceAmount: 100 } })
        .expect(400);
    });

    it('refuses maintenance mode that blocks nothing', async () => {
      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({
          platform: {
            maintenanceMode: true,
            maintenanceMessage: 'Down for work',
            maintenanceBlockedActions: [],
          },
        })
        .expect(400);

      expect(response.body.error.message).toContain('nothing is blocked');
    });

    it('refuses maintenance mode with no message', async () => {
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ platform: { maintenanceMode: true, maintenanceMessage: '' } })
        .expect(400);
    });

    it('refuses an enabled announcement with no text', async () => {
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ platform: { announcementEnabled: true, announcementMessage: '' } })
        .expect(400);
    });

    it('refuses an unknown field rather than silently dropping it', async () => {
      await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { minimumLeadMinutes: 5, nonsense: true } })
        .expect(400);
    });

    it('refuses a change that only conflicts with values already in force', async () => {
      // The section alone is internally valid; it is the combination with the
      // stored document that is not. This is the case a per-section validator
      // would miss.
      await save({ booking: { maximumLeadDays: 2 } });
      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { minimumLeadMinutes: 4320 } })
        .expect(400);

      expect(response.body.error.message).toContain('cannot be combined');
    });
  });

  describe('fail-safe behaviour', () => {
    it('serves defaults and flags the failure when the store throws', async () => {
      modelMethod('platformSetting', 'findUnique').mockRejectedValueOnce(
        new Error('connection lost'),
      );

      const response = await api().get('/api/v1/admin/settings').set(as('ADMIN')).expect(200);

      // The defaults are still the documented behaviour, so the read succeeds -
      // but the admin is told not to trust them.
      expect(response.body.data.settings).toEqual(DEFAULT_PLATFORM_SETTINGS);
      expect(response.body.data.servingDefaultsBecauseReadFailed).toBe(true);
    });

    it('falls back to defaults when the stored document does not parse', async () => {
      modelMethod('platformSetting', 'findUnique').mockResolvedValueOnce({
        document: { booking: 'not an object', service: null },
      });

      const response = await api().get('/api/v1/admin/settings').set(as('ADMIN')).expect(200);
      expect(response.body.data.settings).toEqual(DEFAULT_PLATFORM_SETTINGS);
    });

    it('ignores an unknown field in the stored document', async () => {
      modelMethod('platformSetting', 'findUnique').mockResolvedValueOnce({
        document: {
          booking: { ...DEFAULT_PLATFORM_SETTINGS.booking, somethingFromTheFuture: true },
          service: DEFAULT_PLATFORM_SETTINGS.service,
          platform: DEFAULT_PLATFORM_SETTINGS.platform,
        },
      });

      // Strict schemas reject the whole document, which sends us to defaults.
      // The alternative - accepting a document with an unknown key - is how a
      // renamed setting silently keeps taking effect.
      const response = await api().get('/api/v1/admin/settings').set(as('ADMIN')).expect(200);
      expect(response.body.data.settings).toEqual(DEFAULT_PLATFORM_SETTINGS);
    });

    it('refuses a save when the stored settings could not be read', async () => {
      await save({
        platform: { maintenanceMode: true, maintenanceMessage: 'Upgrade in progress.' },
      });

      /*
       * The read is what fails here. `current()` answers with the shipped defaults
       * in that case, so merging the admin's one-field patch onto them would save the
       * field *and* reset every setting they did not mention - maintenance mode
       * included. The write is refused instead.
       *
       * Losing the change is recoverable; losing the settings around it is not.
       */
      modelMethod('platformSetting', 'findUnique').mockRejectedValueOnce(
        new Error('connection lost'),
      );

      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { minimumLeadMinutes: 120 } });

      expect(response.status).toBe(503);
      // Nothing was written, so maintenance mode is still on.
      //
      // The cache is dropped first: a failed read leaves the service serving the
      // defaults for up to its 15s TTL, which is exactly what the admin screen's
      // "serving defaults because the read failed" warning is for. The point of this
      // assertion is what is *stored*, not what a stale cache is still showing.
      const writes = modelMethod('platformSetting', 'upsert').mock.calls.length;
      harness.app.get(PlatformSettingsService).invalidate();
      const after = await api().get('/api/v1/admin/settings').set(as('ADMIN'));
      expect(modelMethod('platformSetting', 'upsert').mock.calls.length).toBe(writes);
      expect(after.body.data.settings.platform.maintenanceMode).toBe(true);
      expect(after.body.data.settings.platform.maintenanceMessage).toBe('Upgrade in progress.');
    });

    it('refuses a save when the stored document does not parse', async () => {
      await save({ booking: { minimumLeadMinutes: 45 } });

      // A document that stopped validating is just as unknown as one that could not
      // be read: neither is a safe base to merge an admin's change onto.
      modelMethod('platformSetting', 'findUnique').mockResolvedValueOnce({
        document: { booking: 'not an object', service: null },
      });

      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { maximumLeadDays: 30 } });

      expect(response.status).toBe(503);
      harness.app.get(PlatformSettingsService).invalidate();
      const after = await api().get('/api/v1/admin/settings').set(as('ADMIN'));
      expect(after.body.data.settings.booking.minimumLeadMinutes).toBe(45);
    });

    it('allows a save when nothing has ever been stored', async () => {
      /*
       * The mirror image, and the reason the guard above is not simply "never write".
       * With no stored row the defaults *are* the current settings, so a first save is
       * a first save rather than a reset - and refusing it would make the feature
       * unusable until two writes had somehow both failed.
       */
      const response = await api()
        .patch('/api/v1/admin/settings')
        .set(as('ADMIN'))
        .send({ booking: { minimumLeadMinutes: 60 } })
        .expect(200);

      expect(response.body.data.settings.booking.minimumLeadMinutes).toBe(60);
    });
  });

  describe('enforcement: booking rules', () => {
    it('refuses a booking placed before the minimum notice', async () => {
      await save({ booking: { minimumLeadMinutes: 120 } });

      const response = await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(1));

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('at least 2 hours');
    });

    it('allows a booking once the minimum notice has passed', async () => {
      await save({ booking: { minimumLeadMinutes: 60 } });

      await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48))
        .expect(201);
    });

    it('refuses a booking beyond the horizon', async () => {
      await save({ booking: { maximumLeadDays: 7 } });

      const response = await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(24 * 30));

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('7 days ahead');
    });

    it('refuses all new bookings when availability is closed', async () => {
      await save({ booking: { availability: 'CLOSED' } });

      const response = await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48));

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('temporarily closed');
    });

    it('treats 0 as "no restriction" rather than "impossible"', async () => {
      await save({ booking: { minimumLeadMinutes: 0, maximumLeadDays: 0 } });

      // Ten months out, and starting right now: both bounds are switched off, so
      // neither of the two rules above may refuse this.
      await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(24 * 400))
        .expect(201);
    });
  });

  describe('enforcement: cancellation window', () => {
    it('refuses a cancellation inside the notice window', async () => {
      await save({ booking: { cancellationWindowHours: 48 } });

      harness.state.booking = harness.baseBooking({ scheduledStart: hoursFromNow(24) });

      const response = await api()
        .post(`/api/v1/customer/bookings/${bookingId()}/cancel`)
        .set(as('CUSTOMER'));

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('48 hours');
    });

    it('allows a cancellation outside the notice window', async () => {
      await save({ booking: { cancellationWindowHours: 24 } });

      harness.state.booking = harness.baseBooking({ scheduledStart: hoursFromNow(72) });

      await api()
        .post(`/api/v1/customer/bookings/${bookingId()}/cancel`)
        .set(as('CUSTOMER'))
        .expect(201);
    });

    it('does not apply the window at all when it is zero', async () => {
      await save({ booking: { cancellationWindowHours: 0 } });

      harness.state.booking = harness.baseBooking({ scheduledStart: hoursFromNow(1) });

      await api()
        .post(`/api/v1/customer/bookings/${bookingId()}/cancel`)
        .set(as('CUSTOMER'))
        .expect(201);
    });
  });

  describe('enforcement: rescheduling', () => {
    it('refuses a proposal while rescheduling is switched off', async () => {
      await save({ booking: { reschedulingEnabled: false } });

      const response = await api()
        .post(`/api/v1/bookings/${bookingId()}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: hoursFromNow(72).toISOString() });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('unavailable');
    });

    it('refuses a proposal beyond the reschedule horizon', async () => {
      await save({ booking: { rescheduleMaximumLeadDays: 5, maximumLeadDays: 0 } });

      harness.state.booking = harness.baseBooking({ scheduledStart: hoursFromNow(48) });

      const response = await api()
        .post(`/api/v1/bookings/${bookingId()}/reschedule`)
        .set(as('CUSTOMER'))
        .send({ proposedStart: hoursFromNow(24 * 20).toISOString() });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('5 days');
    });
  });

  describe('enforcement: service rules', () => {
    const createService = (body: Record<string, unknown>) =>
      api().post('/api/v1/professional/services').set(as('PROFESSIONAL')).send(body);

    const validService = {
      categoryId: 'c0000000-0000-4000-8000-000000000001',
      title: 'Deep clean',
      description: 'A thorough clean of the whole home, top to bottom.',
      priceAmount: 800,
      durationMinutes: 120,
    };

    it('refuses a job shorter than the configured minimum', async () => {
      await save({ service: { minimumDurationMinutes: 120 } });

      const response = await createService({ ...validService, durationMinutes: 30 });
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('at least 120 minutes');
    });

    it('refuses a price below the configured minimum', async () => {
      await save({ service: { minimumPriceAmount: 500 } });

      const response = await createService({ ...validService, priceAmount: 100 });
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('at least');
    });

    it('refuses a price above the configured maximum', async () => {
      await save({ service: { maximumPriceAmount: 1000 } });

      const response = await createService({ ...validService, priceAmount: 5000 });
      expect(response.status).toBe(400);
    });

    it('still refuses values the request schema rejects, whatever the settings say', async () => {
      // Settings can only tighten. Loosening the service bounds must not make the
      // API accept a duration its own schema has always refused.
      await save({ service: { minimumDurationMinutes: 15, maximumDurationMinutes: 1440 } });

      const response = await createService({ ...validService, durationMinutes: 5 });
      expect(response.status).toBe(400);
    });

    it('creates a listing hidden when moderation is required', async () => {
      await save({ service: { requireModerationBeforePublish: true } });

      await createService(validService).expect(201);

      const row = modelMethod('service', 'create').mock.calls.at(-1)![0].data as Record<
        string,
        unknown
      >;
      expect(row.isActive).toBe(false);
      // A listing the platform moderates starts pending, so it is
      // distinguishable from one an admin has already approved.
      expect(row.moderationStatus).toBe('PENDING');
    });

    it('creates a listing visible when moderation is not required', async () => {
      await save({ service: { requireModerationBeforePublish: false } });

      await createService(validService).expect(201);

      const row = modelMethod('service', 'create').mock.calls.at(-1)![0].data as Record<
        string,
        unknown
      >;
      expect(row.isActive).toBe(true);
      expect(row.moderationStatus).toBe('APPROVED');
    });
  });

  describe('enforcement: maintenance mode', () => {
    it('blocks booking creation with the configured message', async () => {
      await save({
        platform: {
          maintenanceMode: true,
          maintenanceMessage: 'We are upgrading the booking system.',
        },
      });

      const response = await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48));

      expect(response.status).toBe(503);
      expect(response.body.error.message).toBe('We are upgrading the booking system.');
    });

    it('blocks service creation', async () => {
      await save({
        platform: { maintenanceMode: true, maintenanceMessage: 'Paused for maintenance.' },
      });

      const response = await api()
        .post('/api/v1/professional/services')
        .set(as('PROFESSIONAL'))
        .send({
          categoryId: 'c0000000-0000-4000-8000-000000000001',
          title: 'Deep clean',
          description: 'A thorough clean of the whole home, top to bottom.',
          priceAmount: 800,
          durationMinutes: 120,
        });

      expect(response.status).toBe(503);
    });

    it('still serves the marketplace, so customers can read during maintenance', async () => {
      await save({
        platform: { maintenanceMode: true, maintenanceMessage: 'Paused for maintenance.' },
      });

      await api().get('/api/v1/customer/services').expect(200);
    });

    it('stops blocking once maintenance is switched off', async () => {
      await save({
        platform: { maintenanceMode: true, maintenanceMessage: 'Paused for maintenance.' },
      });
      await save({
        platform: { maintenanceMode: false, maintenanceMessage: 'Paused for maintenance.' },
      });

      await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48))
        .expect(201);
    });
  });

  describe('enforcement: notification suppression', () => {
    it('still records the booking when notifications are switched off', async () => {
      await save({ platform: { notificationsEnabled: false } });

      await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48))
        .expect(201);

      // The suppression must not turn into a lost booking: the row is written and
      // only the notice is dropped.
      expect(modelMethod('booking', 'create')).toHaveBeenCalled();
      expect(harness.notifications).toHaveLength(0);
    });

    it('delivers notifications again once they are switched back on', async () => {
      await save({ platform: { notificationsEnabled: false } });
      await save({ platform: { notificationsEnabled: true } });

      await api()
        .post('/api/v1/customer/bookings')
        .set(as('CUSTOMER'))
        .send(bookingRequest(48))
        .expect(201);

      expect(harness.notifications.length).toBeGreaterThan(0);
    });
  });
});

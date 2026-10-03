import type { ProfessionalLifecycleStatus } from '@helpzy/types';
import {
  bookingTimelineSchema,
  completionStateSchema,
  professionalBookingSchema,
  professionalBookingsSchema,
} from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

export function createProfessionalBookingsApi(client: HelpzyApiClient) {
  return {
    listIncoming: (signal?: AbortSignal) =>
      client.get('professional/bookings', { schema: professionalBookingsSchema, signal }),
    get: (bookingId: string, signal?: AbortSignal) =>
      client.get(`professional/bookings/${encodeURIComponent(bookingId)}`, {
        schema: professionalBookingSchema,
        signal,
      }),
    /** The recorded status transitions for this booking, oldest first. */
    timeline: (bookingId: string, signal?: AbortSignal) =>
      client.get(`professional/bookings/${encodeURIComponent(bookingId)}/timeline`, {
        schema: bookingTimelineSchema,
        signal,
      }),
    accept: (bookingId: string) =>
      client.post(`professional/bookings/${encodeURIComponent(bookingId)}/accept`, undefined, {
        schema: professionalBookingSchema,
      }),
    reject: (bookingId: string) =>
      client.post(`professional/bookings/${encodeURIComponent(bookingId)}/reject`, undefined, {
        schema: professionalBookingSchema,
      }),
    /**
     * Moves an accepted booking one step along the professional-controlled
     * lifecycle. The API rejects an out-of-order action, so callers should only
     * offer the action that `nextBookingLifecycleStatus` returns.
     */
    advance: (bookingId: string, action: ProfessionalLifecycleStatus) =>
      client.post(
        `professional/bookings/${encodeURIComponent(bookingId)}/advance`,
        { action },
        { schema: professionalBookingSchema },
      ),
    /**
     * The professional's half of mutual completion.
     *
     * Call this instead of `advance(COMPLETED_BY_PROFESSIONAL)`: `advance` moves
     * the status but records no evidence, so the customer's confirmation would
     * later be told the work had never been stamped as done.
     */
    markCompleted: (bookingId: string, note?: string) =>
      client.post(
        `professional/bookings/${encodeURIComponent(bookingId)}/complete`,
        note === undefined ? {} : { note },
        { schema: completionStateSchema },
      ),
    /** Who has confirmed completion, and whether the professional still owes theirs. */
    completionState: (bookingId: string, signal?: AbortSignal) =>
      client.get(`professional/bookings/${encodeURIComponent(bookingId)}/completion`, {
        schema: completionStateSchema,
        signal,
      }),
  };
}

export type ProfessionalBookingsApi = ReturnType<typeof createProfessionalBookingsApi>;

import {
  rescheduleRequestSchema,
  rescheduleRequestsSchema,
  rescheduleStateSchema,
  type DecideRescheduleDto,
  type RequestRescheduleDto,
} from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

/**
 * Rescheduling, for either party to a booking.
 *
 * The same routes serve both roles: the service resolves which of the
 * customer and the professional the caller is from the booking, so there
 * is no separate namespace per role. A user who is not a party to the
 * booking gets "not found" rather than "forbidden", so a third party
 * learns nothing about the booking's existence.
 */
export function createRescheduleApi(client: HelpzyApiClient) {
  return {
    /** The full proposal history, newest first. */
    list: (bookingId: string, signal?: AbortSignal) =>
      client.get(`bookings/${encodeURIComponent(bookingId)}/reschedule`, {
        schema: rescheduleRequestsSchema,
        signal,
      }),
    /** The live proposal and what this viewer may do with it. */
    state: (bookingId: string, signal?: AbortSignal) =>
      client.get(`bookings/${encodeURIComponent(bookingId)}/reschedule/state`, {
        schema: rescheduleStateSchema,
        signal,
      }),
    /** Propose a new time. The proposer may not answer their own proposal. */
    request: (bookingId: string, input: RequestRescheduleDto) =>
      client.post(`bookings/${encodeURIComponent(bookingId)}/reschedule`, input, {
        schema: rescheduleRequestSchema,
      }),
    /** Accept or reject the other party's proposal. A rejection must say why. */
    decide: (bookingId: string, input: DecideRescheduleDto) =>
      client.post(`bookings/${encodeURIComponent(bookingId)}/reschedule/decide`, input, {
        schema: rescheduleRequestSchema,
      }),
    /** Withdraw a proposal this viewer made. */
    withdraw: (bookingId: string) =>
      client.post(`bookings/${encodeURIComponent(bookingId)}/reschedule/withdraw`, undefined, {
        schema: rescheduleRequestSchema,
      }),
  };
}

export type RescheduleApi = ReturnType<typeof createRescheduleApi>;

import {
  bookingTimelineSchema,
  completionStateSchema,
  customerBookingSchema,
  customerBookingsSchema,
  type CreateCustomerBookingDto,
} from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

export function createCustomerBookingsApi(client: HelpzyApiClient) {
  return {
    create: (booking: CreateCustomerBookingDto) =>
      client.post('customer/bookings', booking, { schema: customerBookingSchema }),
    list: (signal?: AbortSignal) =>
      client.get('customer/bookings', { schema: customerBookingsSchema, signal }),
    get: (bookingId: string, signal?: AbortSignal) =>
      client.get(`customer/bookings/${encodeURIComponent(bookingId)}`, {
        schema: customerBookingSchema,
        signal,
      }),
    /** The recorded status transitions for this booking, oldest first. */
    timeline: (bookingId: string, signal?: AbortSignal) =>
      client.get(`customer/bookings/${encodeURIComponent(bookingId)}/timeline`, {
        schema: bookingTimelineSchema,
        signal,
      }),
    /**
     * The customer's half of mutual completion.
     *
     * This is the endpoint the application uses. It records who confirmed and when,
     * and answers with the completion state rather than the whole booking, so a
     * caller can never read "confirmed" from a response that did not actually
     * record anything.
     */
    markCompleted: (bookingId: string, note?: string) =>
      client.post(
        `customer/bookings/${encodeURIComponent(bookingId)}/complete`,
        note === undefined ? {} : { note },
        { schema: completionStateSchema },
      ),
    /** Who has confirmed completion, and whether the customer still owes theirs. */
    completionState: (bookingId: string, signal?: AbortSignal) =>
      client.get(`customer/bookings/${encodeURIComponent(bookingId)}/completion`, {
        schema: completionStateSchema,
        signal,
      }),
    /**
     * Legacy bare status transition, kept for compatibility with anything written
     * before mutual completion existed.
     *
     * @deprecated It advances the status without recording the customer's
     * confirmation, so `completionState` will still report `isComplete: false`.
     * Use {@link markCompleted}.
     */
    confirmCompletion: (bookingId: string) =>
      client.post(`customer/bookings/${encodeURIComponent(bookingId)}/confirm`, undefined, {
        schema: customerBookingSchema,
      }),
    cancel: (bookingId: string) =>
      client.post(`customer/bookings/${encodeURIComponent(bookingId)}/cancel`, undefined, {
        schema: customerBookingSchema,
      }),
    /**
     * Closes a paid booking.
     *
     * The customer's final step: a booking stays `PAID` until the customer
     * who holds it closes it, which is what the platform counts as the job
     * wrapped up.
     */
    close: (bookingId: string) =>
      client.post(`customer/bookings/${encodeURIComponent(bookingId)}/close`, undefined, {
        schema: customerBookingSchema,
      }),
  };
}

export type CustomerBookingsApi = ReturnType<typeof createCustomerBookingsApi>;

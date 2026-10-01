import {
  bookingTimelineSchema,
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
    /** Confirms a booking the professional marked complete. */
    confirmCompletion: (bookingId: string) =>
      client.post(`customer/bookings/${encodeURIComponent(bookingId)}/confirm`, undefined, {
        schema: customerBookingSchema,
      }),
  };
}

export type CustomerBookingsApi = ReturnType<typeof createCustomerBookingsApi>;

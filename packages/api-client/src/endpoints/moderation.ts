import {
  createReportSchema,
  disputeDetailSchema,
  disputeMessageSchema,
  openDisputeSchema,
  reportSchema,
  type CreateReportDto,
  type OpenDisputeDto,
} from '@helpzy/validation';

import type { HelpzyApiClient } from '../client';

/**
 * Filing a report.
 *
 * Open to any signed-in user: a customer and a professional can both be on the
 * wrong end of something, and neither should have to reach into the other's
 * screens to say so.
 */
export function createReportsApi(client: HelpzyApiClient) {
  return {
    file: (input: CreateReportDto) =>
      client.post('reports', createReportSchema.parse(input), { schema: reportSchema }),
  };
}

export type ReportsApi = ReturnType<typeof createReportsApi>;

/**
 * Disputes over a booking.
 *
 * Both participants use the same calls. The API re-checks that the caller is a
 * party to the booking on every one of them, so a shared client is safe here
 * without the app having to filter the list itself.
 */
export function createDisputesApi(client: HelpzyApiClient) {
  return {
    forBooking: (bookingId: string, signal?: AbortSignal) =>
      client.get(`bookings/${encodeURIComponent(bookingId)}/dispute`, {
        schema: disputeDetailSchema,
        signal,
      }),

    open: (bookingId: string, input: OpenDisputeDto) =>
      client.post(
        `bookings/${encodeURIComponent(bookingId)}/dispute`,
        openDisputeSchema.parse(input),
        { schema: disputeDetailSchema },
      ),

    send: (disputeId: string, body: string) =>
      client.post(
        `disputes/${encodeURIComponent(disputeId)}/messages`,
        disputeMessageSchema.parse({ body }),
        { schema: disputeDetailSchema },
      ),
  };
}

export type DisputesApi = ReturnType<typeof createDisputesApi>;

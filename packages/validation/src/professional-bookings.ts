import { z } from 'zod';
import { BOOKING_STATUSES } from '@helpzy/types';

export const professionalBookingSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(BOOKING_STATUSES),
  scheduledStart: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  requirement: z.string().nullable(),
  service: z.object({ id: z.string().uuid(), title: z.string() }),
  customer: z.object({ id: z.string().uuid(), fullName: z.string() }),
  location: z
    .object({
      label: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
    })
    .nullable(),
});

export const professionalBookingsSchema = z.array(professionalBookingSchema);

/**
 * The professional's job board.
 *
 * Grouped by what a professional can act on rather than by raw status, so the
 * screen has exactly three lists and a new lifecycle status has to be placed
 * into one of them deliberately.
 */
export const professionalJobsSchema = z.object({
  upcoming: z.array(professionalBookingSchema),
  active: z.array(professionalBookingSchema),
  completed: z.array(professionalBookingSchema),
});

export type ProfessionalBookingDto = z.infer<typeof professionalBookingSchema>;
export type ProfessionalJobsDto = z.infer<typeof professionalJobsSchema>;

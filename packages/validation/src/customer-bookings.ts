import { z } from 'zod';
import { BOOKING_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@helpzy/types';

const bookingAddressSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional(),
    type: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(20),
  })
  .strict();

export const createCustomerBookingSchema = z
  .object({
    professionalId: z.string().uuid(),
    serviceId: z.string().uuid(),
    scheduledStart: z.string().datetime({ offset: true }),
    requirement: z.string().trim().max(2000).optional(),
    addressId: z.string().uuid().optional(),
    address: bookingAddressSchema.optional(),
  })
  .strict()
  .refine((input) => Boolean(input.addressId) !== Boolean(input.address), {
    path: ['address'],
    message: 'Choose one saved address or provide a new service address.',
  });

const bookingResponseSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(BOOKING_STATUSES),
  scheduledStart: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  requirement: z.string().nullable(),
  service: z.object({ id: z.string().uuid(), title: z.string() }),
  professional: z.object({ id: z.string().uuid(), fullName: z.string(), businessName: z.string() }),
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

export const customerBookingSchema = bookingResponseSchema.extend({
  payment: z
    .object({
      id: z.string().uuid(),
      status: z.enum(PAYMENT_STATUSES),
      method: z.enum(PAYMENT_METHODS).nullable(),
      amount: z.number().nonnegative(),
      currency: z.string(),
    })
    .nullable()
    .optional(),
  reviewId: z.string().uuid().nullable().optional(),
  unreadMessageCount: z.number().int().nonnegative().optional(),
});
export const customerBookingsSchema = z.array(customerBookingSchema);

export type CreateCustomerBookingDto = z.infer<typeof createCustomerBookingSchema>;
export type CustomerBookingDto = z.infer<typeof customerBookingSchema>;

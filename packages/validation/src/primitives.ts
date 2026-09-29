import { z } from 'zod';

/**
 * Primitives reused by authentication, profiles and bookings.
 * Keeping them here guarantees the API and the app agree on what a valid value
 * looks like (for example `+91 98765 43210` vs `9876543210`).
 */

/** Indian mobile number, stored in E.164 form and entered as 10 digits. */
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .transform((value) => (value.startsWith('+91') ? value.slice(3) : value))
  .refine((value) => INDIAN_MOBILE_REGEX.test(value), {
    message: 'Enter a valid 10 digit Indian mobile number',
  })
  .transform((value) => `+91${value}`);

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6 digit code');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const serviceRadiusKmSchema = z
  .number()
  .int('Service radius must be a whole number of kilometres')
  .min(1)
  .max(100);

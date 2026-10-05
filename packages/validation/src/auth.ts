import { z } from 'zod';

import { marketplaceLocationSlugSchema, otpCodeSchema, phoneSchema } from './primitives';

export const registrationRoleSchema = z.enum(['CUSTOMER', 'PROFESSIONAL']);

export const requestOtpSchema = z
  .object({
    phone: phoneSchema,
  })
  .strict();

export const verifyOtpSchema = z
  .object({
    phone: phoneSchema,
    otp: otpCodeSchema,
  })
  .strict();

export const requestRegistrationOtpSchema = z
  .object({
    phone: phoneSchema,
    role: registrationRoleSchema,
    /**
     * Where the professional trades. Optional, because a professional may
     * complete it from their profile instead; the value is validated against the
     * shared location dataset on the server either way.
     */
    locationSlug: marketplaceLocationSlugSchema.optional(),
  })
  .strict();

export const verifyRegistrationOtpSchema = z
  .object({
    phone: phoneSchema,
    otp: otpCodeSchema,
    role: registrationRoleSchema,
    /**
     * Where the professional trades. Independently validated against the shared
     * location dataset by the service, and validated before the OTP is consumed so
     * a bad slug cannot burn a code.
     *
     * Note what this is *not*: the slug is not stored on the OTP challenge and is
     * not compared with the one sent to `requestRegistrationOtp`. Verification uses
     * whichever slug this request carries. The code proves possession of a phone,
     * not of a location, so it grants no guarantee about where a professional
     * registers. A professional can always change their location from their profile.
     */
    locationSlug: marketplaceLocationSlugSchema.optional(),
  })
  .strict();

export const verifyMfaSchema = z
  .object({
    code: otpCodeSchema,
  })
  .strict();

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RequestRegistrationOtpInput = z.infer<typeof requestRegistrationOtpSchema>;
export type VerifyRegistrationOtpInput = z.infer<typeof verifyRegistrationOtpSchema>;
export type VerifyMfaInput = z.infer<typeof verifyMfaSchema>;

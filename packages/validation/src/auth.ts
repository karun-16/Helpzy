import { z } from 'zod';

import { otpCodeSchema, phoneSchema } from './primitives';

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
  })
  .strict();

export const verifyRegistrationOtpSchema = z
  .object({
    phone: phoneSchema,
    otp: otpCodeSchema,
    role: registrationRoleSchema,
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

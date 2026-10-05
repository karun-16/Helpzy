import type { HelpzyApiClient } from '../client';

export interface RequestOtpPayload {
  phone: string;
}

export interface VerifyOtpPayload {
  phone: string;
  otp: string;
}

export interface RequestRegistrationOtpPayload {
  phone: string;
  role: 'CUSTOMER' | 'PROFESSIONAL';
  /**
   * Where a professional trades. Optional; when omitted the professional completes
   * it from their profile. Validated server-side against the shared dataset.
   */
  locationSlug?: string;
}

export interface VerifyRegistrationOtpPayload extends RequestRegistrationOtpPayload {
  otp: string;
}

export interface VerifyMfaPayload {
  code: string;
}

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: 'CUSTOMER' | 'PROFESSIONAL' | 'ADMIN';
  status: string;
  /** Display only. Lets the header avatar survive a refresh without a fetch. */
  avatarUrl?: string | null;
  mfaVerified?: boolean;
}

export interface AuthSessionResponse {
  token: string;
  user: AuthUser;
  mfaRequired?: boolean;
}

export interface OtpRequestResponse {
  phone: string;
  status: 'OTP_SENT';
  expiresInSeconds: number;
  otp?: string;
}

export interface AuthApi {
  requestOtp: (payload: RequestOtpPayload) => Promise<OtpRequestResponse>;
  verifyOtp: (payload: VerifyOtpPayload) => Promise<AuthSessionResponse>;
  requestRegistrationOtp: (payload: RequestRegistrationOtpPayload) => Promise<OtpRequestResponse>;
  verifyRegistrationOtp: (payload: VerifyRegistrationOtpPayload) => Promise<AuthSessionResponse>;
  verifyMfa: (payload: VerifyMfaPayload) => Promise<AuthSessionResponse>;
  me: () => Promise<{ user: AuthUser | null }>;
}

export function createAuthApi(client: HelpzyApiClient): AuthApi {
  return {
    requestOtp: async (payload) => client.post<OtpRequestResponse>('auth/request-otp', payload),
    verifyOtp: async (payload) => client.post<AuthSessionResponse>('auth/verify-otp', payload),
    requestRegistrationOtp: async (payload) =>
      client.post<OtpRequestResponse>('auth/register/request-otp', payload),
    verifyRegistrationOtp: async (payload) =>
      client.post<AuthSessionResponse>('auth/register/verify-otp', payload),
    verifyMfa: async (payload) =>
      client.post<AuthSessionResponse>('auth/admin/verify-mfa', payload),
    me: async () => client.get<{ user: AuthUser | null }>('auth/me'),
  };
}

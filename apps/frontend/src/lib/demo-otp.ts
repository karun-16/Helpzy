/**
 * Presentation rules for the OTP challenge notice on the sign-in and
 * registration screens.
 *
 * Pure and free of React and platform imports so the messaging can be reasoned
 * about, and tested, on its own.
 *
 * The rule that matters: the UI must never claim an OTP was sent when no
 * provider exists to send it and the server returned no code. A status line that
 * says "use the demo code below" on a deployment that has no demo code sends the
 * user looking for something that does not exist, and hides a genuinely broken
 * sign-in behind what looks like a display bug.
 */
export type OtpChallengeNotice = {
  /** Whether a code was actually returned and can be shown. */
  hasDemoCode: boolean;
  /** Short line describing what happened. */
  headline: string;
  /** Supporting line that sets expectations about delivery. */
  detail: string;
};

export function describeOtpChallenge(phone: string, otp?: string): OtpChallengeNotice {
  if (otp) {
    return {
      hasDemoCode: true,
      headline: `Demo OTP: ${otp}`,
      detail:
        'Project demo - no SMS or email was sent. Enter this code below to continue as this number.',
    };
  }

  return {
    hasDemoCode: false,
    headline: `OTP requested for ${phone}`,
    detail:
      'No code was returned by this server, and no SMS or email provider is configured, so this step cannot be completed here.',
  };
}

/** Status line shown under the request button after a challenge is returned. */
export function describeOtpRequestOutcome(phone: string, otp?: string): string {
  return otp
    ? 'Demo OTP ready - enter the code shown below.'
    : `OTP requested for ${phone}, but this server returned no code, so sign-in cannot be completed here.`;
}

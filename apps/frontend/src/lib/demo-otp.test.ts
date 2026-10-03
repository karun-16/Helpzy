import { describeOtpChallenge, describeOtpRequestOutcome } from './demo-otp';

describe('demo-otp', () => {
  describe('describeOtpChallenge', () => {
    it('returns a demo code notice when a code is present', () => {
      const result = describeOtpChallenge('+919800000001', '123456');

      expect(result.hasDemoCode).toBe(true);
      expect(result.headline).toBe('Demo OTP: 123456');
      expect(result.detail).toContain('no SMS or email was sent');
    });

    it('returns a no-code notice when no code is provided', () => {
      const result = describeOtpChallenge('+919800000001');

      expect(result.hasDemoCode).toBe(false);
      expect(result.headline).toBe('OTP requested for +919800000001');
      expect(result.detail).toContain('no SMS or email provider is configured');
      expect(result.detail).toContain('cannot be completed here');
    });
  });

  describe('describeOtpRequestOutcome', () => {
    it('returns a success message when a demo code is present', () => {
      expect(describeOtpRequestOutcome('+919800000001', '654321')).toBe(
        'Demo OTP ready - enter the code shown below.',
      );
    });

    it('returns a failure message when no code is provided', () => {
      expect(describeOtpRequestOutcome('+919800000001')).toBe(
        'OTP requested for +919800000001, but this server returned no code, so sign-in cannot be completed here.',
      );
    });
  });
});

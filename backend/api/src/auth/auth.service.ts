import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES, type Role } from '@helpzy/types';
import type { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfigRef } from '../config/app-config.token';
import { PrismaService } from '../database/prisma.service';

export interface AuthSessionPayload {
  sub: string;
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: Role;
  status: string;
  mfaVerified?: boolean;
  /**
   * Carried in the token so the header avatar survives a refresh or a fresh
   * sign-in without the client having to fetch the profile first. It is a
   * display value only; every authorisation decision reads the database.
   */
  avatarUrl?: string | null;
  iat: number;
  exp: number;
}

interface StoredOtpChallenge {
  phone: string;
  userId: string;
  code: string;
  expiresAt: number;
  /** Wrong codes already spent on this challenge. */
  attempts: number;
}

interface RegistrationOtpChallenge {
  phone: string;
  role: 'CUSTOMER' | 'PROFESSIONAL';
  code: string;
  expiresAt: number;
  /** Wrong codes already spent on this challenge. */
  attempts: number;
}

/**
 * OTP requests allowed for one phone number inside {@link OTP_REQUEST_WINDOW_MS}.
 *
 * Both request endpoints share this budget because they target the same number:
 * an attacker must not be able to alternate between sign-in and registration to
 * double the codes they can draw.
 */
const OTP_REQUEST_LIMIT = 3;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;

/**
 * Wrong codes a single challenge tolerates before it is destroyed.
 *
 * A six digit code has a million combinations, so without a ceiling a leaked or
 * demo-visible code could be brute forced through the verify endpoint.
 */
const OTP_VERIFY_ATTEMPT_LIMIT = 5;

/**
 * The second factor the demo admin types on the MFA screen.
 *
 * This is a fixed, *known* value on purpose: the demonstration has no
 * authenticator app and no delivery channel for a second factor, so it has to be
 * something the presenter can type from memory. The cost is that MFA is no longer
 * a second factor at all - anyone who reads this repository, and anyone who
 * guesses the admin phone number, can complete admin verification.
 *
 * Acceptable only while this deployment is a closed college demonstration with a
 * throwaway admin account. Before real users are admitted, delete this constant
 * and verify a code that is delivered out of band (TOTP) or generated per session
 * and stored with the challenge.
 *
 * Deliberately backend-only: it is never placed in a response body, returned to a
 * client, or written to a log, so the frontend is not a place it can leak from.
 * Exported so tests assert against the same value instead of restating it.
 */
export const DEMO_ADMIN_MFA_CODE = '162006';

interface UserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  role: Role;
  status: string;
  passwordHash: string;
  avatarUrl?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const FALLBACK_USERS: Record<string, UserRecord> = {
  '+919800000001': {
    id: 'admin-1',
    email: 'admin@helpzy.test',
    phone: '+919800000001',
    fullName: 'Aditi Rao',
    role: ROLES.ADMIN,
    status: 'ACTIVE',
    passwordHash: 'hashed',
  },
  '+919800000002': {
    id: 'customer-1',
    email: 'customer@helpzy.test',
    phone: '+919800000002',
    fullName: 'Rahul Verma',
    role: ROLES.CUSTOMER,
    status: 'ACTIVE',
    passwordHash: 'hashed',
  },
  '+919800000003': {
    id: 'professional-1',
    email: 'meera@helpzy.test',
    phone: '+919800000003',
    fullName: 'Meera Iyer',
    role: ROLES.PROFESSIONAL,
    status: 'ACTIVE',
    passwordHash: 'hashed',
  },
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private warnedAboutInMemoryChallenges = false;
  private warnedAboutSharedMfaCode = false;
  private readonly otpChallenges = new Map<string, StoredOtpChallenge>();
  private readonly registrationOtpChallenges = new Map<string, RegistrationOtpChallenge>();
  private readonly mfaChallenges = new Map<string, StoredOtpChallenge>();
  /** Timestamps of recent OTP requests, keyed by normalised phone number. */
  private readonly otpRequests = new Map<string, number[]>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfigRef,
    private readonly prisma: PrismaService,
  ) {}

  async requestOtp(phone: string): Promise<{
    phone: string;
    status: 'OTP_SENT';
    expiresInSeconds: number;
    otp?: string;
  }> {
    const normalizedPhone = this.normalizePhone(phone);
    this.assertOtpRequestAllowed(normalizedPhone);
    const user = await this.findUserByPhone(normalizedPhone);

    if (!user) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'No account was found for that phone number.',
      });
    }

    const code = this.createOtpCode();
    const expiresAt = new Date(Date.now() + this.config.otpTtlSeconds * 1000);

    if (this.hasLoginChallengeStore()) {
      await this.prisma.otpChallenge.upsert({
        where: { phone: normalizedPhone },
        update: {
          code,
          expiresAt,
          attempts: 0,
          userId: user.id,
        },
        create: {
          phone: normalizedPhone,
          userId: user.id,
          code,
          expiresAt,
          attempts: 0,
        },
      });
    } else {
      this.otpChallenges.set(normalizedPhone, {
        phone: normalizedPhone,
        userId: user.id,
        code,
        expiresAt: expiresAt.getTime(),
        attempts: 0,
      });
    }

    return {
      phone: normalizedPhone,
      status: 'OTP_SENT',
      expiresInSeconds: this.config.otpTtlSeconds,
      ...(this.canRevealOtp() ? { otp: code } : {}),
    };
  }

  async requestRegistrationOtp(
    phone: string,
    role: 'CUSTOMER' | 'PROFESSIONAL',
  ): Promise<{
    phone: string;
    status: 'OTP_SENT';
    expiresInSeconds: number;
    otp?: string;
  }> {
    const normalizedPhone = this.normalizePhone(phone);
    this.assertOtpRequestAllowed(normalizedPhone);
    if (await this.findUserByPhone(normalizedPhone)) {
      throw this.existingAccountException();
    }

    const code = this.createOtpCode();
    const expiresAt = new Date(Date.now() + this.config.otpTtlSeconds * 1000);

    if (this.hasRegistrationChallengeStore()) {
      await this.prisma.registrationOtpChallenge.upsert({
        where: { phone: normalizedPhone },
        update: {
          code,
          expiresAt,
          attempts: 0,
          role,
        },
        create: {
          phone: normalizedPhone,
          role,
          code,
          expiresAt,
          attempts: 0,
        },
      });
    } else {
      this.registrationOtpChallenges.set(normalizedPhone, {
        phone: normalizedPhone,
        role,
        code,
        expiresAt: expiresAt.getTime(),
        attempts: 0,
      });
    }

    return {
      phone: normalizedPhone,
      status: 'OTP_SENT',
      expiresInSeconds: this.config.otpTtlSeconds,
      ...(this.canRevealOtp() ? { otp: code } : {}),
    };
  }

  async verifyRegistrationOtp(
    phone: string,
    otp: string,
    role: 'CUSTOMER' | 'PROFESSIONAL',
  ): Promise<{ token: string; user: AuthSessionUser; mfaRequired: boolean }> {
    const normalizedPhone = this.normalizePhone(phone);

    const challenge = await this.loadRegistrationChallenge(normalizedPhone);

    if (
      !challenge ||
      challenge.expiresAt < Date.now() ||
      challenge.role !== role ||
      challenge.attempts >= OTP_VERIFY_ATTEMPT_LIMIT
    ) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message:
          'The registration OTP is invalid or has expired. Request a new code and try again.',
      });
    }

    if (challenge.code !== String(otp).trim()) {
      await this.spendRegistrationVerificationAttempt(normalizedPhone);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message: 'The registration OTP is incorrect. Check the code and try again.',
      });
    }

    if (!(await this.consumeRegistrationChallenge(normalizedPhone))) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message:
          'The registration OTP is invalid or has expired. Request a new code and try again.',
      });
    }

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.user.findUnique({ where: { phone: normalizedPhone } });
        if (existing) {
          throw this.existingAccountException();
        }

        const fullName = role === ROLES.CUSTOMER ? 'New Customer' : 'New Professional';
        const createdUser = await transaction.user.create({
          data: {
            email: null,
            phone: normalizedPhone,
            passwordHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
            fullName,
            role,
            status: 'ACTIVE',
          },
        });

        if (role === ROLES.CUSTOMER) {
          await transaction.customerProfile.create({ data: { userId: createdUser.id } });
        } else {
          await transaction.professionalProfile.create({
            data: { userId: createdUser.id, businessName: fullName },
          });
        }

        return createdUser;
      });

      return this.createSessionResponse({
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        passwordHash: user.passwordHash,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw this.existingAccountException();
      }
      throw error;
    }
  }

  async verifyOtp(
    phone: string,
    otp: string,
  ): Promise<{ token: string; user: AuthSessionUser; mfaRequired: boolean }> {
    const normalizedPhone = this.normalizePhone(phone);

    const challenge = await this.loadLoginChallenge(normalizedPhone);

    if (
      !challenge ||
      challenge.expiresAt < Date.now() ||
      challenge.attempts >= OTP_VERIFY_ATTEMPT_LIMIT
    ) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message: 'The OTP is invalid or has expired.',
      });
    }

    const trimmedOtp = String(otp).trim();
    if (challenge.code !== trimmedOtp) {
      await this.spendLoginVerificationAttempt(normalizedPhone);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message: 'The OTP code does not match the one that was sent.',
      });
    }

    if (!(await this.consumeLoginChallenge(normalizedPhone))) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.OTP_INVALID,
        message: 'The OTP is invalid or has expired.',
      });
    }

    const user = await this.findUserByPhone(normalizedPhone);
    if (!user) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'The session could not be matched to an active account.',
      });
    }

    if (user.role === ROLES.ADMIN) {
      if (this.config.isProduction) {
        this.warnAboutSharedMfaCode();
      }

      this.mfaChallenges.set(normalizedPhone, {
        phone: normalizedPhone,
        userId: user.id,
        code: DEMO_ADMIN_MFA_CODE,
        expiresAt: Date.now() + this.config.mfaTtlSeconds * 1000,
        attempts: 0,
      });
    }

    return this.createSessionResponse({ ...user, phone: normalizedPhone });
  }

  async verifyMfa(
    authUser: AuthSessionPayload,
    code: string,
  ): Promise<{ token: string; user: AuthSessionUser; mfaRequired: boolean }> {
    if (authUser.role !== ROLES.ADMIN) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'Only admin accounts can verify multi-factor authentication.',
      });
    }

    const challenge = this.mfaChallenges.get(authUser.phone);
    if (
      !challenge ||
      challenge.userId !== authUser.sub ||
      challenge.expiresAt < Date.now() ||
      challenge.attempts >= OTP_VERIFY_ATTEMPT_LIMIT
    ) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.MFA_INVALID,
        message: 'The MFA code is invalid or has expired.',
      });
    }

    const expectedCode = challenge.code;

    if (expectedCode !== String(code).trim()) {
      this.spendVerificationAttempt(this.mfaChallenges, authUser.phone, challenge);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.MFA_INVALID,
        message: 'The MFA code does not match the one that was issued.',
      });
    }

    this.mfaChallenges.delete(authUser.phone);

    const refreshed: AuthSessionPayload = {
      ...authUser,
      mfaVerified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.config.authTokenTtlSeconds,
    };

    const token = this.signToken(refreshed);
    return {
      token,
      user: {
        id: authUser.id,
        email: authUser.email,
        phone: authUser.phone,
        fullName: authUser.fullName,
        role: authUser.role,
        status: authUser.status,
        avatarUrl: authUser.avatarUrl ?? null,
        mfaVerified: true,
      },
      mfaRequired: false,
    };
  }

  async verifyToken(token: string): Promise<AuthSessionPayload> {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'The supplied token is malformed.',
      });
    }

    const expectedSignature = this.signPart(`${header}.${payload}`);
    if (!this.timingSafeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'The supplied token signature is invalid.',
      });
    }

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as AuthSessionPayload;

    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'The supplied token has expired.',
      });
    }

    return parsed;
  }

  async me(userId: string): Promise<AuthSessionUser> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Your session no longer matches an active account.',
      });
    }

    return {
      id: user.id,
      email: user.email ?? '',
      phone: user.phone ?? '',
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl ?? null,
      mfaVerified: user.role === ROLES.ADMIN,
    };
  }

  /**
   * Records, once per process, that admin MFA is a shared demo factor.
   *
   * The warning deliberately does not include the code: a log aggregator is exactly
   * the kind of place this value must not end up.
   */
  private warnAboutSharedMfaCode(): void {
    if (this.warnedAboutSharedMfaCode) {
      return;
    }

    this.warnedAboutSharedMfaCode = true;
    this.logger.warn(
      'Admin MFA is using the shared college-demo code. This deployment must not be opened to real users.',
    );
  }

  private createOtpCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Whether a generated code may travel back in the API response.
   *
   * Development always shows the code, which is what makes local work possible
   * with no provider configured. Production reveals nothing unless an operator
   * turns the demo flag on, so a real deployment cannot leak codes by accident -
   * and because the flag defaults to off, forgetting to configure it fails closed
   * rather than open.
   *
   * The code is never written to a log; the response body is the only channel.
   */
  private canRevealOtp(): boolean {
    return this.config.nodeEnv !== 'production' || this.config.authDemoOtpEnabled;
  }

  /** Records a request and refuses the caller once the window budget is spent. */
  private assertOtpRequestAllowed(phone: string): void {
    const now = Date.now();
    const recent = (this.otpRequests.get(phone) ?? []).filter(
      (timestamp) => now - timestamp < OTP_REQUEST_WINDOW_MS,
    );

    if (recent.length >= OTP_REQUEST_LIMIT) {
      // Keep the timestamps so the caller is still refused until the window
      // genuinely rolls over, rather than resetting the budget on every attempt.
      this.otpRequests.set(phone, recent);
      throw new HttpException(
        {
          code: API_ERROR_CODES.TOO_MANY_REQUESTS,
          message: `Too many OTP requests. Try again in ${Math.ceil(
            (OTP_REQUEST_WINDOW_MS - (now - recent[0]!)) / 60_000,
          )} minute(s).`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.otpRequests.set(phone, recent);
  }

  /**
   * Counts one wrong guess against the stored challenge and destroys it once
   * the ceiling is hit.
   *
   * Both writes are conditional so the row disappears exactly once the limit is
   * reached, and neither swallows a database failure: silently dropping the
   * increment would hand an attacker more guesses than the limit allows.
   */
  private async spendLoginVerificationAttempt(phone: string): Promise<void> {
    if (this.hasLoginChallengeStore()) {
      await this.prisma.otpChallenge.updateMany({
        where: { phone },
        data: { attempts: { increment: 1 } },
      });
      await this.prisma.otpChallenge.deleteMany({
        where: { phone, attempts: { gte: OTP_VERIFY_ATTEMPT_LIMIT } },
      });
      return;
    }

    const challenge = this.otpChallenges.get(phone);
    if (challenge) {
      this.spendVerificationAttempt(this.otpChallenges, phone, challenge);
    }
  }

  private async spendRegistrationVerificationAttempt(phone: string): Promise<void> {
    if (this.hasRegistrationChallengeStore()) {
      await this.prisma.registrationOtpChallenge.updateMany({
        where: { phone },
        data: { attempts: { increment: 1 } },
      });
      await this.prisma.registrationOtpChallenge.deleteMany({
        where: { phone, attempts: { gte: OTP_VERIFY_ATTEMPT_LIMIT } },
      });
      return;
    }

    const challenge = this.registrationOtpChallenges.get(phone);
    if (challenge) {
      challenge.attempts += 1;
      if (challenge.attempts >= OTP_VERIFY_ATTEMPT_LIMIT) {
        this.registrationOtpChallenges.delete(phone);
      }
    }
  }

  private async loadLoginChallenge(phone: string): Promise<StoredOtpChallenge | null> {
    if (this.hasLoginChallengeStore()) {
      const row = await this.prisma.otpChallenge.findUnique({ where: { phone } });
      if (!row) return null;
      return {
        phone: row.phone,
        userId: row.userId,
        code: row.code,
        expiresAt: row.expiresAt.getTime(),
        attempts: row.attempts,
      };
    }
    return this.otpChallenges.get(phone) ?? null;
  }

  private async loadRegistrationChallenge(phone: string): Promise<RegistrationOtpChallenge | null> {
    if (this.hasRegistrationChallengeStore()) {
      const row = await this.prisma.registrationOtpChallenge.findUnique({ where: { phone } });
      if (!row) return null;
      return {
        phone: row.phone,
        role: row.role as 'CUSTOMER' | 'PROFESSIONAL',
        code: row.code,
        expiresAt: row.expiresAt.getTime(),
        attempts: row.attempts,
      };
    }
    return this.registrationOtpChallenges.get(phone) ?? null;
  }

  /**
   * Claims the challenge by deleting it, so a single code can never be spent
   * twice even when two instances verify it at the same moment.
   *
   * Returns false when there was nothing left to claim, which is how a replayed
   * or already consumed code is rejected. Database failures are deliberately not
   * swallowed, because leaving the row behind would keep the code usable.
   */
  private async consumeLoginChallenge(phone: string): Promise<boolean> {
    if (this.hasLoginChallengeStore()) {
      const { count } = await this.prisma.otpChallenge.deleteMany({ where: { phone } });
      return count > 0;
    }

    return this.otpChallenges.delete(phone);
  }

  private async consumeRegistrationChallenge(phone: string): Promise<boolean> {
    if (this.hasRegistrationChallengeStore()) {
      const { count } = await this.prisma.registrationOtpChallenge.deleteMany({ where: { phone } });
      return count > 0;
    }

    return this.registrationOtpChallenges.delete(phone);
  }

  private hasLoginChallengeStore(): boolean {
    if (this.prisma.otpChallenge) {
      return true;
    }

    this.warnAboutInMemoryChallenges();
    return false;
  }

  private hasRegistrationChallengeStore(): boolean {
    if (this.prisma.registrationOtpChallenge) {
      return true;
    }

    this.warnAboutInMemoryChallenges();
    return false;
  }

  /**
   * Guards the in-memory fallback that only test doubles ever reach.
   *
   * A generated client always carries these delegates, so a miss at runtime means
   * the client was generated before the challenge migration. Falling back
   * silently would quietly restore the multi-instance failure the database
   * storage exists to remove.
   */
  private warnAboutInMemoryChallenges(): void {
    if (this.warnedAboutInMemoryChallenges) {
      return;
    }

    this.warnedAboutInMemoryChallenges = true;
    this.logger.warn(
      'Prisma OTP challenge delegates are unavailable; OTP challenges are being held in process memory, which fails whenever more than one instance serves traffic.',
    );
  }

  /**
   * Counts one wrong guess, and destroys the challenge once the ceiling is hit.
   *
   * Destroying it is the point: a brute force gets one challenge worth of
   * attempts, not an unlimited supply of fresh ones.
   */
  private spendVerificationAttempt(
    challenges: Map<string, StoredOtpChallenge>,
    key: string,
    challenge: StoredOtpChallenge,
  ): void {
    challenge.attempts += 1;
    if (challenge.attempts >= OTP_VERIFY_ATTEMPT_LIMIT) {
      challenges.delete(key);
    }
  }

  private createSessionResponse(user: UserRecord): {
    token: string;
    user: AuthSessionUser;
    mfaRequired: boolean;
  } {
    const mfaRequired = user.role === ROLES.ADMIN;
    const session: AuthSessionPayload = {
      sub: user.id,
      id: user.id,
      email: user.email ?? '',
      phone: user.phone ?? '',
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl ?? null,
      mfaVerified: !mfaRequired,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.config.authTokenTtlSeconds,
    };

    return {
      token: this.signToken(session),
      user: {
        id: user.id,
        email: user.email ?? '',
        phone: user.phone ?? '',
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl ?? null,
        mfaVerified: !mfaRequired,
      },
      mfaRequired,
    };
  }

  private existingAccountException(): ConflictException {
    return new ConflictException({
      code: API_ERROR_CODES.CONFLICT,
      message: 'An account already exists for this phone number. Please log in instead.',
    });
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
    if (!/^\+?[1-9]\d{7,14}$/.test(withPlus)) {
      throw new BadRequestException({
        code: API_ERROR_CODES.BAD_REQUEST,
        message: 'Phone numbers must be valid and use international format.',
      });
    }
    return withPlus;
  }

  private async findUserByPhone(phone: string): Promise<UserRecord | null> {
    try {
      const row = await this.prisma.user.findUnique({ where: { phone } });
      if (row) {
        return {
          id: row.id,
          email: row.email,
          phone: row.phone ?? phone,
          fullName: row.fullName,
          role: row.role,
          status: row.status,
          passwordHash: row.passwordHash,
          avatarUrl: row.avatarUrl,
        };
      }
    } catch {
      // A missing database is acceptable during local/dev setup; the auth flow is
      // still validated with the seeded in-memory user store in the e2e tests.
    }

    return FALLBACK_USERS[phone] ?? null;
  }

  private async findUserById(userId: string): Promise<UserRecord | null> {
    try {
      const row = await this.prisma.user.findUnique({ where: { id: userId } });
      if (row) {
        return {
          id: row.id,
          email: row.email,
          phone: row.phone ?? '',
          fullName: row.fullName,
          role: row.role,
          status: row.status,
          passwordHash: row.passwordHash,
          avatarUrl: row.avatarUrl,
        };
      }
    } catch {
      // Ignore database failures and fall back to the same dev user record set.
    }

    return Object.values(FALLBACK_USERS).find((user) => user.id === userId) ?? null;
  }

  private signToken(payload: AuthSessionPayload): string {
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.signPart(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private signPart(value: string): string {
    return createHmac('sha256', this.config.authJwtSecret).update(value).digest('base64url');
  }

  private timingSafeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, 'base64url');
    const b = Buffer.from(right, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export type AuthSessionUser = {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: Role;
  status: string;
  avatarUrl: string | null;
  mfaVerified?: boolean;
};

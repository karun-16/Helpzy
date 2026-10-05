import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@helpzy/types';

import {
  requestOtpSchema,
  requestRegistrationOtpSchema,
  verifyMfaSchema,
  verifyOtpSchema,
  verifyRegistrationOtpSchema,
} from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from './auth.guard';
import { AuthService } from './auth.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/request-otp')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const parsed = requestOtpSchema.parse(body);
    return this.authService.requestOtp(parsed.phone);
  }

  @Post('auth/verify-otp')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown) {
    const parsed = verifyOtpSchema.parse(body);
    return this.authService.verifyOtp(parsed.phone, parsed.otp);
  }

  @Post('auth/register/request-otp')
  @HttpCode(200)
  async requestRegistrationOtp(@Body() body: unknown) {
    const parsed = requestRegistrationOtpSchema.parse(body);
    return this.authService.requestRegistrationOtp(parsed.phone, parsed.role, parsed.locationSlug);
  }

  @Post('auth/register/verify-otp')
  @HttpCode(200)
  async verifyRegistrationOtp(@Body() body: unknown) {
    const parsed = verifyRegistrationOtpSchema.parse(body);
    return this.authService.verifyRegistrationOtp(
      parsed.phone,
      parsed.otp,
      parsed.role,
      parsed.locationSlug,
    );
  }

  @Get('auth/me')
  @UseGuards(AuthGuard)
  async me(@Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      return { user: null };
    }

    return { user: await this.authService.me(user.sub) };
  }

  @Post('auth/admin/verify-mfa')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async verifyMfa(@Req() req: RequestWithUser, @Body() body: unknown) {
    const parsed = verifyMfaSchema.parse(body);
    if (!req.user) {
      throw new Error('Authentication context is missing.');
    }

    return this.authService.verifyMfa(req.user, parsed.code);
  }

  @Get('admin/dashboard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  async adminDashboard(@Req() req: RequestWithUser) {
    return {
      dashboard: 'admin',
      user: req.user,
      message: 'Admin access granted.',
    };
  }

  @Get('customer/dashboard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.CUSTOMER)
  async customerDashboard(@Req() req: RequestWithUser) {
    return {
      dashboard: 'customer',
      user: req.user,
      message: 'Customer access granted.',
    };
  }

  @Get('professional/dashboard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.PROFESSIONAL)
  async professionalDashboard(@Req() req: RequestWithUser) {
    return {
      dashboard: 'professional',
      user: req.user,
      message: 'Professional access granted.',
    };
  }
}

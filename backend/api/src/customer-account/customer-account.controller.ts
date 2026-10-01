import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import { updateCustomerProfileSchema, upsertCustomerAddressSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CustomerAccountService } from './customer-account.service';
import { parseProfilePhotoInput } from '../media/profile-photo.service';

@Controller('customer/account')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.CUSTOMER)
export class CustomerAccountController {
  constructor(private readonly account: CustomerAccountService) {}

  @Get('profile')
  getProfile(@Req() request: RequestWithUser) {
    return this.account.getProfile(request.user!.id);
  }

  @Patch('profile')
  updateProfile(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.account.updateProfile(
      request.user!.id,
      parseOrThrow(updateCustomerProfileSchema, body),
    );
  }

  @Post('profile/photo')
  uploadPhoto(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.account.uploadAvatar(request.user!.id, parseProfilePhotoInput(body));
  }

  @Get('addresses')
  listAddresses(@Req() request: RequestWithUser) {
    return this.account.listAddresses(request.user!.id);
  }

  @Post('addresses')
  createAddress(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.account.createAddress(
      request.user!.id,
      parseOrThrow(upsertCustomerAddressSchema, body),
    );
  }

  @Patch('addresses/:addressId')
  updateAddress(
    @Req() request: RequestWithUser,
    @Param('addressId') addressId: string,
    @Body() body: unknown,
  ) {
    return this.account.updateAddress(
      request.user!.id,
      addressId,
      parseOrThrow(upsertCustomerAddressSchema, body),
    );
  }

  @Patch('addresses/:addressId/default')
  setDefaultAddress(@Req() request: RequestWithUser, @Param('addressId') addressId: string) {
    return this.account.setDefaultAddress(request.user!.id, addressId);
  }

  @Delete('addresses/:addressId')
  deleteAddress(@Req() request: RequestWithUser, @Param('addressId') addressId: string) {
    return this.account.deleteAddress(request.user!.id, addressId);
  }
}

function parseOrThrow<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Please check the details and try again.',
    details: parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      messages: [issue.message],
    })),
  });
}

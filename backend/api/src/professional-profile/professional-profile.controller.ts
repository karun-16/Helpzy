import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { API_ERROR_CODES, ROLES } from '@helpzy/types';
import { updateProfessionalProfileSchema } from '@helpzy/validation';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProfessionalProfileService } from './professional-profile.service';
import { parseProfilePhotoInput } from '../media/profile-photo.service';

@Controller('professional/profile')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.PROFESSIONAL)
export class ProfessionalProfileController {
  constructor(private readonly profile: ProfessionalProfileService) {}

  @Get()
  getOwn(@Req() request: RequestWithUser) {
    return this.profile.getOwnProfile(request.user!.id);
  }

  @Post('photo')
  uploadPhoto(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.profile.uploadAvatar(request.user!.id, parseProfilePhotoInput(body));
  }

  @Patch()
  updateOwn(@Req() request: RequestWithUser, @Body() body: unknown) {
    const parsed = updateProfessionalProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Please check the details and try again.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          messages: [issue.message],
        })),
      });
    }
    return this.profile.updateOwnProfile(request.user!.id, parsed.data);
  }
}

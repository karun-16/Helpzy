import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfessionalProfileController } from './professional-profile.controller';
import { ProfessionalProfileService } from './professional-profile.service';
import {
  AdminVerificationDocumentsController,
  ProfessionalVerificationDocumentsController,
} from './verification-documents.controller';
import { VerificationDocumentsService } from './verification-documents.service';

@Module({
  imports: [AuthModule, MediaModule, AuditModule, NotificationsModule],
  controllers: [
    ProfessionalProfileController,
    ProfessionalVerificationDocumentsController,
    AdminVerificationDocumentsController,
  ],
  providers: [ProfessionalProfileService, VerificationDocumentsService],
})
export class ProfessionalProfileModule {}

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ProfessionalServicesController } from './professional-services.controller';
import { ProfessionalServicesService } from './professional-services.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalServicesController],
  providers: [ProfessionalServicesService],
})
export class ProfessionalServicesModule {}

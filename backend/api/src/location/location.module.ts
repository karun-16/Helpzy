import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CustomerLocationController, ProfessionalLocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalLocationController, CustomerLocationController],
  providers: [LocationService],
})
export class LocationModule {}

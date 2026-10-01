import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingLifecycleModule } from '../bookings/booking-lifecycle.module';
import { ProfessionalBookingsController } from './professional-bookings.controller';
import { ProfessionalBookingsService } from './professional-bookings.service';

@Module({
  imports: [AuthModule, BookingLifecycleModule],
  controllers: [ProfessionalBookingsController],
  providers: [ProfessionalBookingsService],
})
export class ProfessionalBookingsModule {}

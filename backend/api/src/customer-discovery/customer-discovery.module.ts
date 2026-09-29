import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CustomerDiscoveryController } from './customer-discovery.controller';
import { CustomerDiscoveryService } from './customer-discovery.service';

@Module({
  imports: [AuthModule],
  controllers: [CustomerDiscoveryController],
  providers: [CustomerDiscoveryService],
})
export class CustomerDiscoveryModule {}

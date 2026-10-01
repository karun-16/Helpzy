import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingChatController } from './booking-chat.controller';
import { BookingChatService } from './booking-chat.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [BookingChatController],
  providers: [BookingChatService],
})
export class BookingChatModule {}

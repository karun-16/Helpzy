import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { AuthGuard, type RequestWithUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles('CUSTOMER', 'PROFESSIONAL', 'ADMIN')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * The signed-in user's own notifications. There is no way to ask for another
   * user's notifications: the recipient is always the session user.
   */
  @Get()
  list(@Req() request: RequestWithUser) {
    return this.notifications.listForUser(request.user!.id);
  }

  @Get('unread-count')
  async unreadCount(@Req() request: RequestWithUser) {
    return { unreadCount: await this.notifications.countUnread(request.user!.id) };
  }

  @Patch('read-all')
  async markAllRead(@Req() request: RequestWithUser) {
    return { updated: await this.notifications.markAllRead(request.user!.id) };
  }

  @Patch(':notificationId/read')
  markRead(@Req() request: RequestWithUser, @Param('notificationId') notificationId: string) {
    return this.notifications.markRead(request.user!.id, notificationId);
  }
}

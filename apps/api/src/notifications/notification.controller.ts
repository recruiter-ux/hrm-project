import { Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QueryNotificationsDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

/**
 * Everything under /api/notifications.
 *
 * NO @RequirePermission ANYWHERE IN THIS FILE, AND THAT IS DELIBERATE.
 *
 * Every endpoint here reads or writes exactly one person's own notifications,
 * identified from the signed-in token — there is no parameter that could name
 * a different recipient. A permission with a scope would be theatre: the only
 * scope that makes sense is SELF, and SELF is already structurally enforced by
 * not accepting a recipient id.
 *
 * The global JwtAuthGuard still applies, so an anonymous caller gets 401.
 * `@Public()` is absent, which is what keeps that true.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Notifications belong to an EMPLOYEE, not to a login. An account with no
   * employee record has nothing to show — and would otherwise crash on a null
   * id, so this is checked once here.
   */
  private employeeIdOf(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      throw new ForbiddenException('Your login is not linked to an employee record.');
    }
    return user.employeeId;
  }

  /** The bell's dropdown: newest first, with the unread count alongside. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryNotificationsDto) {
    return this.notifications.list(this.employeeIdOf(user), {
      unreadOnly: query.unreadOnly,
      take: query.take,
    });
  }

  /** Just the number — polled by the header, so it stays cheap. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(this.employeeIdOf(user));
  }

  /** Was the email actually sent? Answers it for your own notification. */
  @Get(':id/deliveries')
  deliveries(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.deliveries(this.employeeIdOf(user), id);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(this.employeeIdOf(user), id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(this.employeeIdOf(user));
  }
}

import { Global, Module } from '@nestjs/common';

import { EmailService } from './email/email.service';
import { NotificationController } from './notification.controller';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationService } from './notification.service';

/**
 * Global, like PrismaModule and StorageModule.
 *
 * Notifying people is infrastructure that every module needs — Leave today,
 * Recruitment and Attendance next. Making it global means a new module injects
 * `NotificationService` and is done, with no import wiring to forget and no
 * temptation to write its own alerts instead.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationDispatcherService, EmailService],
  exports: [NotificationService, NotificationDispatcherService, EmailService],
})
export class NotificationModule {}

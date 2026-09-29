import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * Global, like PrismaModule and StorageModule, so any module can inject
 * AuditService without importing anything. Auditing is infrastructure, not a
 * feature — a module should not have to opt in to being accountable.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

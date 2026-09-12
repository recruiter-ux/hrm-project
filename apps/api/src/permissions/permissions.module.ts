import { Global, Module } from '@nestjs/common';

import { PermissionsService } from './permissions.service';

/**
 * @Global because nearly every feature module needs to narrow a query by
 * scope. Saves importing it in each one.
 */
@Global()
@Module({
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}

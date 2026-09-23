import { Module } from '@nestjs/common';

import { LeaveController } from './leave.controller';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveService } from './leave.service';
import { LeaveTypesService } from './leave-types.service';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, LeaveTypesService, LeavePolicyService],
  exports: [LeaveService, LeavePolicyService],
})
export class LeaveModule {}

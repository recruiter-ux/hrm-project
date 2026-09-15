import { Module } from '@nestjs/common';

import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveTypesService } from './leave-types.service';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, LeaveTypesService],
  exports: [LeaveService],
})
export class LeaveModule {}

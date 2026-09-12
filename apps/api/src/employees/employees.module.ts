import { Module } from '@nestjs/common';

import { EmploymentAssignmentService } from '../assignments/employment-assignment.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmploymentAssignmentService],
  exports: [EmployeesService, EmploymentAssignmentService],
})
export class EmployeesModule {}

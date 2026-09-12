import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser, ResolvedPermission } from '../auth/auth.types';
import { CurrentUser, Scope } from '../auth/decorators/current-user.decorator';
import { EmploymentAssignmentService } from '../assignments/employment-assignment.service';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

/**
 * Everything under /api/employees.
 *
 * ROUTE ORDER MATTERS. The literal paths (`options`, `org-chart`, `drift`)
 * are declared BEFORE `:id`, otherwise Nest would treat "options" as an
 * employee id and every one of those requests would 404.
 */
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly assignments: EmploymentAssignmentService,
  ) {}

  @Get()
  @RequirePermission('employee:read')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Query() query: QueryEmployeesDto,
  ) {
    return this.employees.findAll(user.employeeId, permission.scope, query);
  }

  /** Dropdown data for the create and edit forms. */
  @Get('options')
  @RequirePermission('employee:read')
  getOptions() {
    return this.employees.getFormOptions();
  }

  @Get('org-chart')
  @RequirePermission('employee:read')
  getOrgChart(@CurrentUser() user: AuthenticatedUser, @Scope() permission: ResolvedPermission) {
    return this.employees.getOrgChart(user.employeeId, permission.scope);
  }

  /**
   * Integrity check: lists any employee whose cached job fields have drifted
   * from their open assignment. Should always return an empty array — a
   * non-empty result means something wrote to the employee row directly.
   *
   * Gated on access_role:manage because it is an administrative diagnostic.
   */
  @Get('drift')
  @RequirePermission('access_role:manage')
  findDrift() {
    return this.assignments.findDrift();
  }

  @Get(':id')
  @RequirePermission('employee:read')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    return this.employees.findOne(user.employeeId, permission.scope, id);
  }

  @Get(':id/history')
  @RequirePermission('employment_assignment:read')
  async getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    // findOne performs the scope check and throws 404 if out of range.
    const employee = await this.employees.findOne(user.employeeId, permission.scope, id);
    return employee.assignmentHistory;
  }

  @Post()
  @RequirePermission('employee:create')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto, user.employeeId);
  }

  @Patch(':id')
  @RequirePermission('employee:update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(user.employeeId, permission.scope, id, dto);
  }

  /** Soft delete — the record is retained, just hidden from the directory. */
  @Delete(':id')
  @RequirePermission('employee:delete')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    return this.employees.archive(user.employeeId, permission.scope, id);
  }
}

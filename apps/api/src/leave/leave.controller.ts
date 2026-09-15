import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LeaveRequestStatus } from '@prisma/client';

import type { AuthenticatedUser, ResolvedPermission } from '../auth/auth.types';
import { CurrentUser, Scope } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  QueryBalancesDto,
  QueryLeaveRequestsDto,
  SetBalanceDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LeaveService } from './leave.service';
import { LeaveTypesService } from './leave-types.service';

/**
 * Everything under /api/leave.
 *
 * As elsewhere, literal paths are declared before `:id` routes so that
 * "balances" is never mistaken for a request id.
 */
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly types: LeaveTypesService,
  ) {}

  // --- Leave types (reference data) ------------------------------------------

  @Get('types')
  @RequirePermission('leave_type:read')
  listTypes(@Query('includeInactive') includeInactive?: string) {
    return this.types.findAll(includeInactive === 'true');
  }

  @Post('types')
  @RequirePermission('leave_type:manage')
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.types.create(dto);
  }

  @Patch('types/:id')
  @RequirePermission('leave_type:manage')
  updateType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.types.update(id, dto);
  }

  @Post('types/:id/retire')
  @RequirePermission('leave_type:manage')
  retireType(@Param('id') id: string) {
    return this.types.deactivate(id);
  }

  // --- Balances ---------------------------------------------------------------

  /** Omit `employeeId` to see your own. */
  @Get('balances')
  @RequirePermission('leave_balance:read')
  getBalances(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Query() query: QueryBalancesDto,
  ) {
    return this.leave.getBalances(user.employeeId, permission.scope, query);
  }

  @Post('balances')
  @RequirePermission('leave_balance:manage')
  setBalance(@Body() dto: SetBalanceDto) {
    return this.leave.setBalance(dto);
  }

  // --- Requests ---------------------------------------------------------------

  @Get('requests')
  @RequirePermission('leave_request:read')
  listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Query() query: QueryLeaveRequestsDto,
  ) {
    return this.leave.listRequests(user.employeeId, permission.scope, query);
  }

  @Get('requests/:id')
  @RequirePermission('leave_request:read')
  getRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    return this.leave.getRequest(user.employeeId, permission.scope, id);
  }

  @Post('requests')
  @RequirePermission('leave_request:create')
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leave.createRequest(user.employeeId, permission.scope, dto);
  }

  @Post('requests/:id/approve')
  @RequirePermission('leave_request:approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
  ) {
    return this.leave.decideRequest(
      user.employeeId,
      permission.scope,
      id,
      LeaveRequestStatus.APPROVED,
      dto.comment,
    );
  }

  @Post('requests/:id/reject')
  @RequirePermission('leave_request:approve')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
  ) {
    return this.leave.decideRequest(
      user.employeeId,
      permission.scope,
      id,
      LeaveRequestStatus.REJECTED,
      dto.comment,
    );
  }

  /** Withdrawn by the employee. Distinct from a manager's rejection. */
  @Post('requests/:id/cancel')
  @RequirePermission('leave_request:cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    return this.leave.cancelRequest(user.employeeId, permission.scope, id);
  }
}

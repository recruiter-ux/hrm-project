import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LeaveRequestStatus } from '@prisma/client';

import type { AuthenticatedUser, ResolvedPermission } from '../auth/auth.types';
import { CurrentUser, Scope } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import {
  AmendPolicyVersionDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  CreatePolicyVersionDto,
  DecideLeaveRequestDto,
  PolicyOnDateDto,
  QueryBalancesDto,
  QueryLeaveRequestsDto,
  SetBalanceDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LeavePolicyService } from './leave-policy.service';
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
    private readonly policies: LeavePolicyService,
  ) {}

  // --- Leave types (identity) ------------------------------------------------

  @Get('types')
  @RequirePermission('leave_type:read')
  listTypes(@Query('includeInactive') includeInactive?: string) {
    return this.types.findAll(includeInactive === 'true');
  }

  @Get('types/:id')
  @RequirePermission('leave_type:read')
  getType(@Param('id') id: string) {
    return this.types.findOne(id);
  }

  @Post('types')
  @RequirePermission('leave_policy:manage')
  createType(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveTypeDto) {
    return this.types.create(dto, user.employeeId);
  }

  @Patch('types/:id')
  @RequirePermission('leave_policy:manage')
  updateType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.types.update(id, dto);
  }

  /** Archive, not delete — historical requests must keep resolving the name. */
  @Post('types/:id/archive')
  @RequirePermission('leave_policy:manage')
  archiveType(@Param('id') id: string) {
    return this.types.archive(id);
  }

  @Post('types/:id/restore')
  @RequirePermission('leave_policy:manage')
  restoreType(@Param('id') id: string) {
    return this.types.restore(id);
  }

  // --- Policy versions (effective-dated rules) -------------------------------

  /** Full version history for one type, newest first. */
  @Get('types/:id/policies')
  @RequirePermission('leave_policy:read')
  listPolicyVersions(@Param('id') id: string) {
    return this.policies.listVersions(id);
  }

  /**
   * THE HISTORICAL LOOKUP.
   * `GET /api/leave/types/:id/policy-on?date=2026-03-15` → the rules in force
   * that day, not today's rules.
   */
  @Get('types/:id/policy-on')
  @RequirePermission('leave_policy:read')
  async policyOnDate(@Param('id') id: string, @Query() query: PolicyOnDateDto) {
    const policy = await this.policies.getPolicyOn(id, new Date(query.date));
    return policy ? this.policies.shape(policy) : null;
  }

  /** How a year's entitlement is derived, period by period. */
  @Get('types/:id/entitlement')
  @RequirePermission('leave_policy:read')
  entitlement(@Param('id') id: string, @Query('year') year?: string) {
    const targetYear = year ? parseInt(year, 10) : new Date().getUTCFullYear();
    return this.policies.calculateEntitlement(id, targetYear);
  }

  /** Opens a new version and closes the current one. Never rewrites history. */
  @Post('types/:id/policies')
  @RequirePermission('leave_policy:manage')
  createPolicyVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePolicyVersionDto,
  ) {
    return this.policies.createVersion(
      id,
      { ...dto, effectiveFrom: new Date(dto.effectiveFrom) },
      user.employeeId,
    );
  }

  /** Corrects a note or carry-forward cap. Quota and dates are immutable. */
  @Patch('policies/:policyId')
  @RequirePermission('leave_policy:manage')
  amendPolicyVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('policyId') policyId: string,
    @Body() dto: AmendPolicyVersionDto,
  ) {
    return this.policies.amendVersion(policyId, dto, user.employeeId);
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

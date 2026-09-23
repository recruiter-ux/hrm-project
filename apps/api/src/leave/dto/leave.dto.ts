import { Transform, Type } from 'class-transformer';
import { LeaveRequestStatus, ProrationMethod } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// -----------------------------------------------------------------------------
// Leave types (reference data)
// -----------------------------------------------------------------------------

/**
 * Creating a leave type also creates its FIRST policy version, so this DTO
 * carries both the type's identity and the opening rules.
 */
export class CreateLeaveTypeDto {
  // --- Identity --------------------------------------------------------------
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be upper-case letters, numbers, and underscores, e.g. ANNUAL.',
  })
  code!: string;

  @IsString() @MinLength(2) @MaxLength(80) name!: string;

  @IsOptional() @IsString() @MaxLength(500) description?: string;

  @IsOptional() @IsBoolean() isPaid?: boolean;

  /** False for unpaid leave, which can be taken without any entitlement. */
  @IsOptional() @IsBoolean() requiresBalance?: boolean;

  @IsOptional()
  @IsEnum(ProrationMethod, {
    message: 'prorationMethod must be PRORATED_BY_DAYS or LATEST_POLICY_IN_YEAR.',
  })
  prorationMethod?: ProrationMethod;

  // --- Opening policy version ------------------------------------------------
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365) quotaDays!: number;

  @IsOptional() @IsBoolean() approvalRequired?: boolean;

  @IsOptional() @IsBoolean() carryForwardEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  carryForwardMaxDays?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(365) minNoticeDays?: number;

  /** Defaults to 1 January of the current year. */
  @IsOptional() @IsDateString() effectiveFrom?: string;

  @IsOptional() @IsString() @MaxLength(500) policyNotes?: string;
}

/**
 * Edits a type's IDENTITY only.
 *
 * Quota, notice period, and the approval rule are deliberately absent —
 * changing those creates a new effective-dated policy version instead, which
 * is what preserves history. Sending them here is rejected with a 400 by the
 * global ValidationPipe's `forbidNonWhitelisted`.
 */
export class UpdateLeaveTypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsBoolean() requiresBalance?: boolean;
  @IsOptional() @IsEnum(ProrationMethod) prorationMethod?: ProrationMethod;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// -----------------------------------------------------------------------------
// Policy versions
// -----------------------------------------------------------------------------

/** Opens a new effective-dated policy version, closing the current one. */
export class CreatePolicyVersionDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365) quotaDays!: number;

  @IsBoolean() approvalRequired!: boolean;

  @IsBoolean() carryForwardEnabled!: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  carryForwardMaxDays?: number | null;

  @IsInt() @Min(0) @Max(365) minNoticeDays!: number;

  @IsDateString({}, { message: 'effectiveFrom must be a date, e.g. 2026-07-01.' })
  effectiveFrom!: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/**
 * Corrects a version in place. Deliberately narrow — only the note and the
 * carry-forward cap. A quota or date change is a NEW version, never an edit,
 * or history would be rewritten.
 */
export class AmendPolicyVersionDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  carryForwardMaxDays?: number | null;
}

/** Historical lookup: what were the rules on this date? */
export class PolicyOnDateDto {
  @IsDateString({}, { message: 'date must be a date, e.g. 2026-03-15.' })
  date!: string;
}

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

/**
 * A per-employee deviation from the policy.
 *
 * Note this no longer sets "the entitlement" — entitlement comes from the
 * effective-dated policy. This records an exception: an override, or days
 * carried in from last year.
 */
export class SetBalanceDto {
  @IsString() employeeId!: string;
  @IsString() leaveTypeId!: string;

  @IsInt() @Min(2000) @Max(2100) year!: number;

  /** Null (or omitted) means "use the policy calculation" — the normal case. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(365)
  entitlementOverrideDays?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365) carriedForwardDays?: number;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class QueryBalancesDto {
  /** Omit to see your own. */
  @IsOptional() @IsString() employeeId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export class CreateLeaveRequestDto {
  @IsString() leaveTypeId!: string;

  @IsDateString({}, { message: 'startDate must be a date, e.g. 2026-10-05.' })
  startDate!: string;

  @IsDateString({}, { message: 'endDate must be a date, e.g. 2026-10-09.' })
  endDate!: string;

  @IsString()
  @MinLength(3, { message: 'Give a reason of at least 3 characters.' })
  @MaxLength(1000)
  reason!: string;

  /**
   * Submit on behalf of someone else. HR-only in practice — the service
   * rejects it unless the caller can create requests beyond their own record.
   */
  @IsOptional() @IsString() employeeId?: string;
}

export class DecideLeaveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class QueryLeaveRequestsDto {
  @IsOptional() @IsEnum(LeaveRequestStatus) status?: LeaveRequestStatus;

  @IsOptional() @IsString() employeeId?: string;

  @IsOptional() @IsString() leaveTypeId?: string;

  /**
   * `true` narrows to requests awaiting THIS user's decision — the manager's
   * approvals queue.
   */
  @IsOptional()
  @Transform(({ obj }) => {
    // Read the raw value: the global ValidationPipe's implicit conversion
    // turns the string 'false' into boolean true. See PROJECT_NOTES section 8.
    const raw = (obj as Record<string, unknown>).awaitingMyDecision;
    return raw === true || raw === 'true' || raw === '1';
  })
  awaitingMyDecision?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 25;
}

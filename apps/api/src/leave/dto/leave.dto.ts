import { Transform, Type } from 'class-transformer';
import { LeaveRequestStatus } from '@prisma/client';
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
} from 'class-validator';

// -----------------------------------------------------------------------------
// Leave types (reference data)
// -----------------------------------------------------------------------------

export class CreateLeaveTypeDto {
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

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365)
  defaultAnnualDays?: number;
}

export class UpdateLeaveTypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsBoolean() requiresBalance?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365) defaultAnnualDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

export class SetBalanceDto {
  @IsString() employeeId!: string;
  @IsString() leaveTypeId!: string;

  @IsInt() @Min(2000) @Max(2100) year!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(365) entitledDays!: number;

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

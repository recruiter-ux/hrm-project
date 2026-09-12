import { AssignmentChangeReason, EmploymentType, WorkLocationType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * A change to someone's employment arrangement.
 *
 * THE SHAPE IS THE SAFEGUARD. The five tracked fields are only reachable
 * through this nested object, and this object cannot be submitted without
 * `effectiveFrom` and `reason`. Combined with the global ValidationPipe's
 * `forbidNonWhitelisted: true`, sending `roleId` at the top level of an
 * employee update is rejected with a 400 rather than silently applied.
 *
 * In other words: you cannot change someone's department without saying when
 * it happened and why. That is not a policy in a comment — the API enforces it.
 */
export class AssignmentChangeDto {
  @IsString()
  roleId!: string;

  @IsString()
  departmentId!: string;

  /** Null is meaningful: the person reports to nobody. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  managerId!: string | null;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(WorkLocationType)
  workLocationType!: WorkLocationType;

  /** First day the new arrangement applies. Must be after the current one began. */
  @IsDateString({}, { message: 'effectiveFrom must be a date, e.g. 2026-04-01.' })
  effectiveFrom!: string;

  @IsEnum(AssignmentChangeReason, {
    message:
      'reason must be one of: HIRE, PROMOTION, DEMOTION, LATERAL_MOVE, DEPARTMENT_TRANSFER, MANAGER_CHANGE, EMPLOYMENT_TYPE_CHANGE, WORK_LOCATION_CHANGE, REORGANISATION, TERMINATION, DATA_CORRECTION.',
  })
  reason!: AssignmentChangeReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

import { EmploymentStatus, EmploymentType, WorkLocationType } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Creating an employee also creates their first EmploymentAssignment (reason
 * HIRE), in the same transaction. That is why the job fields are required
 * here — an employee with no open assignment is an invalid state, so we never
 * allow one to exist even briefly.
 */
export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'employeeNumber may contain only letters, numbers, and hyphens (e.g. HM-0042).',
  })
  employeeNumber!: string;

  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;

  @IsOptional() @IsString() @MaxLength(100) preferredName?: string;

  @IsEmail({}, { message: 'workEmail must be a valid email address.' })
  @MaxLength(255)
  workEmail!: string;

  @IsOptional() @IsEmail({}, { message: 'personalEmail must be a valid email address.' })
  @MaxLength(255)
  personalEmail?: string;

  @IsOptional() @IsString() @MaxLength(40) phoneNumber?: string;

  /** IANA timezone. Attendance is meaningless without it. */
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;

  @IsDateString({}, { message: 'hiredAt must be a date, e.g. 2026-04-01.' })
  hiredAt!: string;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  /** Free-text override, e.g. "Software Engineer II, Platform". */
  @IsOptional() @IsString() @MaxLength(150) workingTitle?: string;

  // --- Initial assignment ----------------------------------------------------
  @IsString() roleId!: string;
  @IsString() departmentId!: string;

  @IsOptional() @IsString() managerId?: string | null;

  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(WorkLocationType) workLocationType?: WorkLocationType;
}

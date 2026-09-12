import { Type } from 'class-transformer';
import { EmploymentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { AssignmentChangeDto } from './assignment-change.dto';

/**
 * Editing an employee.
 *
 * Note what is NOT here: `roleId`, `departmentId`, `managerId`,
 * `employmentType`, `workLocationType`. Those five live only inside
 * `assignment`, which requires an effective date and a reason.
 *
 * Because the global ValidationPipe runs with `forbidNonWhitelisted: true`,
 * putting any of them at the top level produces a 400 explaining the mistake,
 * rather than a silent history-corrupting write.
 */
export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(100) preferredName?: string;

  @IsOptional() @IsEmail({}, { message: 'workEmail must be a valid email address.' })
  @MaxLength(255)
  workEmail?: string;

  @IsOptional() @IsEmail({}, { message: 'personalEmail must be a valid email address.' })
  @MaxLength(255)
  personalEmail?: string;

  @IsOptional() @IsString() @MaxLength(40) phoneNumber?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(150) workingTitle?: string;

  @IsOptional() @IsEnum(EmploymentStatus) status?: EmploymentStatus;

  @IsOptional() @IsDateString() probationEndsAt?: string;
  @IsOptional() @IsDateString() terminatedAt?: string;

  /**
   * Present only when the job itself is changing. Omit it for a plain
   * correction of someone's phone number.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AssignmentChangeDto)
  assignment?: AssignmentChangeDto;
}

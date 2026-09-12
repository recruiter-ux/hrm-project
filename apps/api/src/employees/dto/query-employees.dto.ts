import { Type } from 'class-transformer';
import { EmploymentStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class QueryEmployeesDto {
  /** Matches against name, work email, and employee number. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;

  @IsOptional() @IsString() departmentId?: string;

  @IsOptional() @IsEnum(EmploymentStatus) status?: EmploymentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}

import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryNotificationsDto {
  @IsOptional()
  @Transform(({ obj }) => {
    // Read the RAW value. The global ValidationPipe's implicit conversion
    // turns the string 'false' into boolean true — see PROJECT_NOTES §8.
    const raw = (obj as Record<string, unknown>).unreadOnly;
    return raw === true || raw === 'true' || raw === '1';
  })
  unreadOnly?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number = 30;
}

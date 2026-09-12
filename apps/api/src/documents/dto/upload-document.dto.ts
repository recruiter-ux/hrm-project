import { Transform } from 'class-transformer';
import { DocumentType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Sent as multipart/form-data alongside the file, so every value arrives as a
 * string — hence the @Transform on the boolean.
 */
export class UploadDocumentDto {
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;

  /**
   * Medical notes, disciplinary records — visible only with
   * document:read_confidential.
   *
   * Reads the RAW value off `obj` rather than the already-transformed `value`.
   * The global ValidationPipe runs with `enableImplicitConversion: true`, which
   * coerces a string to a boolean with `Boolean(value)` — and `Boolean('false')`
   * is `true`. Reading the untouched source avoids that trap, which would
   * otherwise silently mark every uploaded document confidential.
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as Record<string, unknown>).isConfidential;
    return raw === true || raw === 'true' || raw === '1';
  })
  isConfidential?: boolean;

  @IsOptional() @IsDateString() issuedAt?: string;

  /** Visas, work permits, and certifications lapse — this drives expiry reports. */
  @IsOptional() @IsDateString() expiresAt?: string;
}

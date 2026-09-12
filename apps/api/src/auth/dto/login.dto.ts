import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email!: string;

  /**
   * No complexity rules on LOGIN on purpose — those belong on password
   * creation. Rejecting a login for "weak password" would tell an attacker
   * something about the stored value.
   */
  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  @MaxLength(200)
  password!: string;
}

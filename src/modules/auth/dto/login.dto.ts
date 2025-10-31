import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Data Transfer Object for user login requests.
 * Validates email format and password presence with sanitization.
 *
 * @remarks
 * This DTO handles:
 * - Email format validation
 * - Password presence validation
 * - Input sanitization and trimming
 * - API documentation generation
 */
export class LoginDto {
  /**
   * User's email address for authentication.
   * Must be a valid email format and is required.
   */
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'User email address',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.trim().toLowerCase())
  email: string;

  /**
   * User's password for authentication.
   * Must be present and will be validated against stored hash.
   */
  @ApiProperty({
    example: 'Password123!',
    description: 'User password',
    minLength: 1
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(1, { message: 'Password cannot be empty' })
  @MaxLength(128, { message: 'Password is too long' })
  password: string;
}

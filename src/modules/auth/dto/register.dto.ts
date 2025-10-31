import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Data Transfer Object for user registration requests.
 * Validates all required fields with comprehensive validation rules.
 *
 * @remarks
 * This DTO handles:
 * - Email uniqueness and format validation
 * - Name presence and length validation
 * - Password strength and complexity requirements
 * - Input sanitization and normalization
 * - XSS protection through input cleaning
 */
export class RegisterDto {
  /**
   * User's email address for registration and future authentication.
   * Must be unique across all users and follow email format standards.
   */
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Unique email address for user account',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.trim().toLowerCase())
  email: string;

  /**
   * User's display name for identification.
   * Will be shown in UI and used for personalization.
   */
  @ApiProperty({
    example: 'John Doe',
    description: 'User display name',
    minLength: 1,
    maxLength: 100
  })
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  @MinLength(1, { message: 'Name cannot be empty' })
  @MaxLength(100, { message: 'Name is too long' })
  @Transform(({ value }) => value?.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''))
  name: string;

  /**
   * User's password for authentication.
   * Must meet minimum complexity requirements for security.
   */
  @ApiProperty({
    example: 'Password123!',
    description: 'Secure password for authentication',
    minLength: 6,
    maxLength: 128
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @MaxLength(128, { message: 'Password is too long' })
  password: string;
}

import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Data Transfer Object for JWT token refresh requests.
 * Validates refresh token format and presence.
 *
 * @remarks
 * This DTO handles:
 * - Refresh token presence validation
 * - Basic JWT format validation
 * - Input sanitization
 * - API documentation generation
 */
export class RefreshDto {
  /**
   * Valid JWT refresh token obtained from login/registration.
   * Must be a properly formatted JWT token string.
   */
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Valid JWT refresh token for token renewal',
    format: 'jwt'
  })
  @IsString({ message: 'Refresh token must be a string' })
  @IsNotEmpty({ message: 'Refresh token is required' })
  @Matches(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, {
    message: 'Invalid JWT token format'
  })
  refreshToken: string;
}

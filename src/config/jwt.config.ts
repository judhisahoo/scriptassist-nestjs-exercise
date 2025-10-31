import { registerAs } from '@nestjs/config';

/**
 * JWT (JSON Web Token) configuration using NestJS Config module
 *
 * This configuration provides settings for JWT token generation and validation
 * used in authentication and authorization. It implements a secure token rotation
 * strategy with separate access and refresh tokens for optimal security.
 *
 * Configuration includes:
 * - JWT secret key for token signing and verification
 * - Access token expiration (short-lived for security)
 * - Refresh token expiration (longer-lived for user experience)
 * - Token rotation strategy for enhanced security
 *
 * @remarks
 * - Used by JwtModule.registerAsync() in auth.module.ts
 * - Implements secure token rotation pattern
 * - Access tokens are short-lived (15 minutes) for security
 * - Refresh tokens are longer-lived (7 days) for usability
 * - Secret key should be strong and environment-specific
 */
export default registerAs('jwt', () => ({
  /** Secret key used for JWT signing and verification - must be kept secure */
  secret: process.env.JWT_SECRET || 'your-secret-key',

  /** Access token expiration time - short-lived for security (15 minutes) */
  accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',

  /** Refresh token expiration time - longer-lived for user experience (7 days) */
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRATION || '7d',
}));

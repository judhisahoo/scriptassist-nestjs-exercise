import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

/**
 * JWT Passport Strategy for token validation and user extraction.
 * Configures JWT token extraction from Authorization header and validates tokens.
 *
 * @remarks
 * This strategy:
 * - Extracts JWT from Bearer token in Authorization header
 * - Validates token signature and expiration
 * - Retrieves user data from database
 * - Returns sanitized user object for request context
 *
 * @example
 * ```typescript
 * // Automatically used by JwtAuthGuard
 * @UseGuards(JwtAuthGuard)
 * getProtectedRoute(@CurrentUser() user: User) { ... }
 * ```
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * Creates an instance of JwtStrategy with JWT configuration.
   *
   * @param configService - Service for accessing JWT configuration
   * @param usersService - Service for user data retrieval
   */
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      // Extract JWT from Authorization header (Bearer token)
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // Do not ignore token expiration - reject expired tokens
      ignoreExpiration: false,

      // JWT secret for token verification
      secretOrKey: configService.get('jwt.secret'),
    });
  }

  /**
   * Validates JWT payload and returns user data for authenticated requests.
   * Called automatically by Passport after token verification.
   *
   * @param payload - Decoded JWT payload containing user claims
   * @returns Sanitized user object attached to request
   * @throws UnauthorizedException if user not found or invalid
   * @remarks
   * TODO: Add user status validation (active/inactive/suspended)
   * TODO: Implement token blacklisting check
   * TODO: Add user permission/role validation
   * TODO: Implement user data caching for performance
   * TODO: Add token usage tracking and analytics
   */
  async validate(payload: any) {
    // Extract user ID from JWT subject claim
    const userId = payload.sub;

    // Retrieve user from database
    const user = await this.usersService.findOne(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Return sanitized user object (exclude sensitive data like password)
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}

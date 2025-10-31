import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT Authentication Guard that protects routes requiring user authentication.
 * Extends Passport's AuthGuard to validate JWT tokens in request headers.
 *
 * @remarks
 * This guard:
 * - Validates JWT tokens using the configured JWT strategy
 * - Attaches authenticated user to request object
 * - Throws UnauthorizedException for invalid/missing tokens
 * - Can be used as route guard or globally
 *
 * @example
 * ```typescript
 * // Protect specific route
 * @UseGuards(JwtAuthGuard)
 * getProtectedData() { ... }
 *
 * // Protect entire controller
 * @UseGuards(JwtAuthGuard)
 * export class ProtectedController { ... }
 * ```
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Determines if the current request can proceed based on JWT authentication.
   * Called automatically by NestJS guard system.
   *
   * @param context - Execution context containing request/response objects
   * @returns True if authentication succeeds, throws exception otherwise
   * @remarks
   * TODO: Add custom authentication logic (e.g., token blacklisting)
   * TODO: Implement rate limiting for authentication attempts
   * TODO: Add authentication metrics and monitoring
   * TODO: Implement multi-tenant authentication support
   */
  canActivate(context: ExecutionContext) {
    // Call parent AuthGuard logic for JWT validation
    return super.canActivate(context);
  }
}

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard that enforces role-based access control (RBAC)
 * Checks if the authenticated user has one of the required roles
 * Uses metadata set by the @Roles decorator
 *
 * Should be used in conjunction with JWT authentication guards
 * that populate the request.user object
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Determines if the current user has the required roles for the route
   * @param context - Execution context containing request information
   * @returns true if user has required role, false otherwise
   */
  canActivate(context: ExecutionContext): boolean {
    // Get required roles from metadata (set by @Roles decorator)
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), // Check method-level metadata first
      context.getClass(),   // Then class-level metadata
    ]);

    // If no roles are required, allow access
    if (!requiredRoles) {
      return true;
    }

    // Extract user from request (should be set by authentication guard)
    const { user } = context.switchToHttp().getRequest();

    // Check if user has one of the required roles
    return requiredRoles.some(role => user.role === role);
  }
}

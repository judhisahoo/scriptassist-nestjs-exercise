import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for role-based authorization
 * Used by RolesGuard to identify required roles for routes
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for route access
 * Sets metadata that is consumed by the RolesGuard for authorization
 *
 * @param roles - Array of role names required to access the route
 * @returns Decorator function that sets role metadata
 *
 * @example
 * ```typescript
 * @Roles('admin', 'moderator')
 * @Post('admin/users')
 * createUser() {
 *   return this.userService.createUser();
 * }
 * ```
 *
 * @example
 * ```typescript
 * @Roles('user')
 * @Get('profile')
 * getProfile() {
 *   return this.userService.getProfile();
 * }
 * ```
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

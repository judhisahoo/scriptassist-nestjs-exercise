import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Parameter decorator that extracts the authenticated user from the request object.
 * Used in controller methods to access the current authenticated user.
 *
 * @param data - Optional property key to extract from the user object
 * @param ctx - Execution context containing the request
 * @returns The authenticated user object or specific user property
 * @remarks
 * TODO: Add user data validation and sanitization
 * TODO: Implement user data caching for performance
 * TODO: Add user permission checking within decorator
 * TODO: Consider implementing user data transformation
 *
 * @example
 * ```typescript
 * // Get entire user object
 * getProfile(@CurrentUser() user: User) { ... }
 *
 * // Get specific user property
 * getUserId(@CurrentUser('id') userId: string) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // Return specific property if requested, otherwise return entire user object
    return data ? user?.[data as string] : user;
  },
);

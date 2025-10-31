import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for rate limiting configuration
 * Used by RateLimitGuard to identify rate-limited routes
 */
export const RATE_LIMIT_KEY = 'rate_limit';

/**
 * Configuration options for rate limiting
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the time window */
  limit: number;
  /** Time window in milliseconds for rate limiting */
  windowMs: number;
}

/**
 * Decorator to apply rate limiting to routes
 * Sets metadata that is consumed by the RateLimitGuard
 * Note: This decorator sets metadata but actual enforcement is handled by the guard
 *
 * @param options - Rate limiting configuration
 * @returns Decorator function that sets rate limit metadata
 *
 * @example
 * ```typescript
 * @RateLimit({ limit: 100, windowMs: 60000 }) // 100 requests per minute
 * @Get('api/data')
 * getData() {
 *   return this.service.getData();
 * }
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => {
  return SetMetadata(RATE_LIMIT_KEY, options);
};

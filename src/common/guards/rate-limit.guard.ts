import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

/**
 * In-memory storage for rate limiting data
 * Maps hashed IP addresses to request counts and reset times
 * Uses Map for O(1) access performance
 */
const requestRecords: Map<string, { count: number; resetTime: number }> = new Map();

/**
 * Guard that enforces rate limiting on HTTP requests
 * Uses in-memory storage with automatic cleanup to prevent memory leaks
 * Supports configurable limits and time windows per route
 *
 * Features:
 * - IP-based rate limiting with privacy-preserving hashing
 * - Configurable request limits and time windows
 * - Automatic cleanup of expired records
 * - Proper HTTP 429 responses with retry information
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Determines if the request should be allowed based on rate limiting rules
   * @param context - Execution context containing request information
   * @returns boolean indicating if request should proceed
   */
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = this.hashIP(request.ip); // Hash IP for privacy compliance

    // Get rate limit configuration from metadata
    const rateLimitOptions = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Use defaults if no specific configuration provided
    const limit = rateLimitOptions?.limit || 100;
    const windowMs = rateLimitOptions?.windowMs || 60 * 1000; // 1 minute default

    return this.handleRateLimit(ip, limit, windowMs);
  }

  /**
   * Creates a simple hash of IP address for privacy-preserving identification
   * Uses djb2 algorithm for consistent hashing without exposing actual IPs
   * @param ip - Original IP address string
   * @returns Hashed identifier string
   */
  private hashIP(ip: string): string {
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      const char = ip.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Core rate limiting logic
   * Tracks request counts per IP within sliding time windows
   * @param ip - Hashed IP identifier
   * @param maxRequests - Maximum requests allowed in time window
   * @param windowMs - Time window duration in milliseconds
   * @returns true if request allowed, throws HttpException if rate limited
   */
  private handleRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const record = requestRecords.get(ip);

    if (!record || now > record.resetTime) {
      // First request in window or window has expired
      requestRecords.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (record.count >= maxRequests) {
      // Rate limit exceeded - calculate retry time
      const resetIn = Math.ceil((record.resetTime - now) / 1000);
      throw new HttpException(
        {
          status: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Rate limit exceeded',
          message: `Too many requests. Try again in ${resetIn} seconds.`,
          retryAfter: resetIn,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Increment request count
    record.count++;
    return true;
  }
}

/**
 * Periodic cleanup to prevent memory leaks
 * Removes expired rate limit records every 5 minutes
 * Runs in background without blocking request processing
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of requestRecords.entries()) {
    if (now > record.resetTime) {
      requestRecords.delete(ip);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

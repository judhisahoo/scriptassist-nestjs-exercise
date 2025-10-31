import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Configuration options for distributed lock operations.
 * Defines retry behavior, TTL, and clock drift handling.
 */
export interface LockOptions {
  /** Time to live in milliseconds for the lock */
  ttl: number;
  /** Number of retry attempts for lock acquisition */
  retryCount: number;
  /** Delay between retry attempts in milliseconds */
  retryDelay: number;
  /** Clock drift factor for Redlock algorithm (typically 0.01) */
  driftFactor: number;
}

/**
 * Service for distributed locking using Redis.
 * Implements reliable distributed locks with retry logic, automatic expiration,
 * and atomic lock operations to prevent race conditions in multi-instance deployments.
 *
 * @remarks
 * This service provides:
 * - Redis-based distributed locking with SET NX PX
 * - Automatic retry with exponential backoff
 * - Lock extension and force release capabilities
 * - Lock metadata and monitoring
 * - Atomic lock validation using Lua scripts
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  /** Redis client instance for lock operations */
  private redisClient: Redis;

  /** Prefix for all lock keys to avoid collisions */
  private readonly lockPrefix = 'lock:';

  /** Default lock options with sensible defaults */
  private readonly defaultOptions: LockOptions = {
    ttl: 30000, // 30 seconds default TTL
    retryCount: 3, // Retry up to 3 times
    retryDelay: 100, // 100ms base delay
    driftFactor: 0.01, // 1% clock drift allowance
  };

  /**
   * Creates an instance of DistributedLockService.
   *
   * @param configService - Service for accessing application configuration
   * @param injectedRedisClient - Optional pre-configured Redis client (for testing or shared instances)
   */
  constructor(
    private configService: ConfigService,
    @Optional() @Inject('REDIS_CLIENT') private injectedRedisClient?: Redis,
  ) {
    // Use injected Redis client if provided, otherwise initialize new connection
    if (this.injectedRedisClient) {
      this.redisClient = this.injectedRedisClient;
    } else {
      this.initializeRedis();
    }
  }

  /**
   * Initializes Redis client connection for lock operations.
   * Sets up event handlers for connection monitoring.
   *
   * @private
   * @remarks
   * TODO: Implement circuit breaker pattern for connection failures
   * TODO: Add connection pooling for better performance
   * TODO: Support Redis cluster and sentinel configurations
   * TODO: Implement exponential backoff for reconnection attempts
   */
  private initializeRedis() {
    try {
      // Build Redis configuration from environment variables
      const redisConfig = {
        host: this.configService.get('redis.host', 'localhost'),
        port: this.configService.get('redis.port', 6379),
        password: this.configService.get('redis.password'), // TODO: Sanitize sensitive data in logs
        db: this.configService.get('redis.db', 0),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      this.redisClient = new Redis(redisConfig);

      // Monitor Redis connection events
      this.redisClient.on('connect', () => {
        this.logger.log('Distributed lock service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Distributed lock service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for distributed locks:', error);
    }
  }

  /**
   * Lifecycle hook called when the module is being destroyed.
   * Ensures proper cleanup of Redis connections.
   *
   * @remarks
   * TODO: Implement graceful shutdown with pending lock operations handling
   * TODO: Add connection draining before shutdown
   * TODO: Log active locks during shutdown for debugging
   */
  async onModuleDestroy() {
    if (this.redisClient && !this.injectedRedisClient) {
      await this.redisClient.quit();
    }
  }

  /**
   * Acquires a distributed lock using Redis SET NX PX command.
   * Implements retry logic with exponential backoff for reliable lock acquisition.
   *
   * @param resource - Unique identifier for the resource to lock
   * @param ownerId - Identifier of the lock owner (typically instance or session ID)
   * @param options - Optional lock configuration overriding defaults
   * @returns Lock value string if acquired, null if failed
   * @remarks
   * TODO: Implement Redlock algorithm for multiple Redis instances
   * TODO: Add lock acquisition metrics and monitoring
   * TODO: Implement deadlock detection and prevention
   * TODO: Add lock queueing for high-contention scenarios
   */
  async acquireLock(
    resource: string,
    ownerId: string,
    options?: Partial<LockOptions>,
  ): Promise<string | null> {
    const opts = { ...this.defaultOptions, ...options };
    const lockKey = this.getLockKey(resource);
    const lockValue = `${ownerId}:${Date.now()}`;

    // Retry lock acquisition with exponential backoff
    for (let attempt = 0; attempt <= opts.retryCount; attempt++) {
      try {
        // Atomic SET NX PX operation - only succeeds if key doesn't exist
        const result = await this.redisClient.set(
          lockKey,
          lockValue,
          'PX', // Expire in milliseconds
          opts.ttl,
          'NX', // Only set if key doesn't exist
        );

        if (result === 'OK') {
          this.logger.debug(`Lock acquired: ${lockKey} by ${ownerId}`);
          return lockValue;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < opts.retryCount) {
          await this.delay(opts.retryDelay * (attempt + 1));
        }
      } catch (error) {
        this.logger.error(`Error acquiring lock ${lockKey}:`, error);
        // Continue retrying on errors
        if (attempt < opts.retryCount) {
          await this.delay(opts.retryDelay * (attempt + 1));
        }
      }
    }

    this.logger.warn(`Failed to acquire lock: ${lockKey} after ${opts.retryCount + 1} attempts`);
    return null;
  }

  /**
   * Releases a distributed lock using atomic Lua script to prevent race conditions.
   * Only releases the lock if the provided lock value matches the current value.
   *
   * @param resource - The resource identifier for the lock
   * @param lockValue - The lock value returned by acquireLock (used for ownership verification)
   * @returns True if the lock was successfully released, false otherwise
   * @remarks
   * TODO: Add lock release metrics and monitoring
   * TODO: Implement lock release timeout handling
   * TODO: Add audit logging for lock operations
   * TODO: Consider implementing lock renewal instead of release for long operations
   */
  async releaseLock(resource: string, lockValue: string): Promise<boolean> {
    const lockKey = this.getLockKey(resource);

    try {
      // Atomic check-and-delete using Lua script to prevent race conditions
      const script = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redisClient.eval(script, 1, lockKey, lockValue);

      if (result === 1) {
        this.logger.debug(`Lock released: ${lockKey}`);
        return true;
      } else {
        this.logger.warn(`Lock not released (value mismatch): ${lockKey}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error releasing lock ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Executes a function with automatic lock acquisition and release.
   * Provides a convenient wrapper for operations requiring exclusive access.
   *
   * @param resource - The resource to lock during operation execution
   * @param ownerId - Identifier for the lock owner
   * @param operation - Async function to execute while holding the lock
   * @param options - Optional lock configuration
   * @returns The result of the operation function
   * @throws Error if lock acquisition fails
   * @remarks
   * TODO: Add operation timeout handling
   * TODO: Implement lock renewal during long operations
   * TODO: Add operation metrics and performance monitoring
   * TODO: Consider implementing lock inheritance for nested operations
   */
  async executeWithLock<T>(
    resource: string,
    ownerId: string,
    operation: () => Promise<T>,
    options?: Partial<LockOptions>,
  ): Promise<T> {
    const lockValue = await this.acquireLock(resource, ownerId, options);

    if (!lockValue) {
      throw new Error(`Failed to acquire lock for resource: ${resource}`);
    }

    try {
      // Execute the operation while holding the lock
      const result = await operation();
      return result;
    } finally {
      // Always release the lock, even if operation throws
      await this.releaseLock(resource, lockValue);
    }
  }

  /**
   * Checks if a resource is currently locked by any owner.
   *
   * @param resource - The resource identifier to check
   * @returns True if the resource is locked, false otherwise
   * @remarks
   * TODO: Add lock status caching for performance
   * TODO: Implement lock ownership verification
   * TODO: Add lock expiration time checking
   * TODO: Consider implementing lock queue length monitoring
   */
  async isLocked(resource: string): Promise<boolean> {
    const lockKey = this.getLockKey(resource);
    try {
      const exists = await this.redisClient.exists(lockKey);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Error checking lock status for ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Retrieves detailed information about a lock's current state.
   *
   * @param resource - The resource identifier to get info for
   * @returns Object containing lock status, owner, acquisition time, and TTL
   * @remarks
   * TODO: Add lock history tracking
   * TODO: Implement lock analytics and reporting
   * TODO: Add lock expiration warnings
   * TODO: Consider implementing lock transfer capabilities
   */
  async getLockInfo(resource: string): Promise<{
    locked: boolean;
    owner?: string;
    acquiredAt?: number;
    ttl?: number;
  }> {
    const lockKey = this.getLockKey(resource);

    try {
      const value = await this.redisClient.get(lockKey);
      const ttl = await this.redisClient.pttl(lockKey);

      if (value && ttl > 0) {
        const [owner, acquiredAtStr] = value.split(':');
        return {
          locked: true,
          owner,
          acquiredAt: parseInt(acquiredAtStr, 10),
          ttl,
        };
      }

      return { locked: false };
    } catch (error) {
      this.logger.error(`Error getting lock info for ${lockKey}:`, error);
      return { locked: false };
    }
  }

  /**
   * Forcefully releases a lock without ownership verification.
   * USE WITH EXTREME CAUTION - can cause race conditions and data corruption.
   *
   * @param resource - The resource identifier to force release
   * @returns True if a lock was released, false otherwise
   * @remarks
   * CRITICAL: This method bypasses ownership checks and can cause data corruption
   * TODO: Add administrative controls and audit logging
   * TODO: Implement emergency lock release with confirmation
   * TODO: Add lock force release metrics and alerts
   * TODO: Consider implementing lock quarantine instead of force release
   */
  async forceReleaseLock(resource: string): Promise<boolean> {
    const lockKey = this.getLockKey(resource);

    try {
      const result = await this.redisClient.del(lockKey);
      if (result > 0) {
        this.logger.warn(`Lock force released: ${lockKey}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Error force releasing lock ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Extends the TTL of an existing lock without releasing it.
   * Useful for long-running operations that need to maintain exclusive access.
   *
   * @param resource - The resource identifier for the lock
   * @param lockValue - The lock value returned by acquireLock
   * @param additionalTtl - Additional TTL in milliseconds to add
   * @returns True if the lock TTL was extended, false otherwise
   * @remarks
   * TODO: Add lock extension metrics and monitoring
   * TODO: Implement automatic lock renewal for long operations
   * TODO: Add maximum extension limits to prevent infinite locks
   * TODO: Consider implementing lock extension callbacks
   */
  async extendLock(resource: string, lockValue: string, additionalTtl: number): Promise<boolean> {
    const lockKey = this.getLockKey(resource);

    try {
      const script = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('PEXPIRE', KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redisClient.eval(
        script,
        1,
        lockKey,
        lockValue,
        additionalTtl.toString()
      );

      if (result === 1) {
        this.logger.debug(`Lock extended: ${lockKey} by ${additionalTtl}ms`);
        return true;
      } else {
        this.logger.warn(`Lock not extended (value mismatch): ${lockKey}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error extending lock ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Generates a prefixed lock key to avoid collisions with other Redis keys.
   *
   * @private
   * @param resource - The resource identifier
   * @returns Prefixed lock key for Redis
   */
  private getLockKey(resource: string): string {
    return `${this.lockPrefix}${resource}`;
  }

  /**
   * Creates a promise-based delay for retry logic.
   *
   * @private
   * @param ms - Delay duration in milliseconds
   * @returns Promise that resolves after the specified delay
   * @remarks
   * TODO: Consider using a more efficient timer implementation
   * TODO: Add delay metrics for performance monitoring
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
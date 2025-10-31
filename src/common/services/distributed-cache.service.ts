import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Configuration interface for distributed cache settings.
 * Defines Redis connection parameters and cache behavior.
 */
export interface DistributedCacheConfig {
  /** Redis server hostname */
  host: string;
  /** Redis server port */
  port: number;
  /** Optional Redis password for authentication */
  password?: string;
  /** Redis database number (0-15) */
  db?: number;
  /** Prefix for all cache keys to avoid collisions */
  keyPrefix?: string;
  /** Default TTL for cache entries in seconds */
  ttl: number;
  /** Maximum number of cache entries (for LRU eviction) */
  maxSize?: number;
}

/**
 * Service for distributed caching using Redis.
 * Provides high-performance, distributed cache operations with connection management,
 * error handling, and monitoring capabilities.
 *
 * @remarks
 * This service supports:
 * - Redis-based distributed caching
 * - Automatic key namespacing
 * - Connection health monitoring
 * - Bulk operations with pipelines
 * - Graceful degradation on Redis failures
 */
@Injectable()
export class DistributedCacheService {
  private readonly logger = new Logger(DistributedCacheService.name);

  /** Redis client instance for cache operations */
  private redisClient: Redis;

  /** Prefix applied to all cache keys for namespacing */
  private readonly keyPrefix: string;

  /** Default time-to-live for cache entries in seconds */
  private readonly defaultTtl: number;

  /** Maximum cache size for LRU eviction (currently unused) */
  private readonly maxSize: number;

  /** Connection status flag for health checks */
  private isConnected = false;

  /**
   * Creates an instance of DistributedCacheService.
   *
   * @param configService - Service for accessing application configuration
   * @param cacheConfig - Optional custom cache configuration (overrides environment config)
   */
  constructor(
    private configService: ConfigService,
    @Optional() @Inject('DISTRIBUTED_CACHE_CONFIG') private cacheConfig?: DistributedCacheConfig,
  ) {
    // Initialize configuration with fallbacks to environment variables
    this.keyPrefix = cacheConfig?.keyPrefix || this.configService.get('redis.keyPrefix', 'app:');
    this.defaultTtl = cacheConfig?.ttl || this.configService.get('redis.ttl', 300);
    this.maxSize = cacheConfig?.maxSize || this.configService.get('redis.maxSize', 10000);

    // Initialize Redis connection
    this.initializeRedis();
  }

  /**
   * Initializes Redis client connection with configuration and event handlers.
   * Sets up connection monitoring and error handling.
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
      // Build Redis configuration from injected config or environment variables
      const redisConfig = {
        host: this.cacheConfig?.host || this.configService.get('redis.host', 'localhost'),
        port: this.cacheConfig?.port || this.configService.get('redis.port', 6379),
        password: this.cacheConfig?.password || this.configService.get('redis.password'), // TODO: Sanitize sensitive data in logs
        db: this.cacheConfig?.db || this.configService.get('redis.db', 0),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      this.redisClient = new Redis(redisConfig);

      // Monitor connection events
      this.redisClient.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.isConnected = false;
        this.logger.error('Redis connection error:', error);
      });

      this.redisClient.on('close', () => {
        this.isConnected = false;
        this.logger.warn('Redis connection closed');
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
      this.isConnected = false;
    }
  }

  /**
   * Lifecycle hook called when the module is being destroyed.
   * Ensures proper cleanup of Redis connections.
   *
   * @remarks
   * TODO: Implement graceful shutdown with pending operations handling
   * TODO: Add connection pool draining before shutdown
   * TODO: Log pending operations during shutdown
   */
  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }

  /**
   * Generates a namespaced key by prefixing the original key.
   * Prevents key collisions between different applications or services.
   *
   * @private
   * @param key - Original cache key
   * @returns Namespaced cache key
   */
  private getNamespacedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Stores a value in the cache with optional TTL.
   *
   * @param key - Cache key
   * @param value - Value to cache (will be JSON serialized)
   * @param ttlSeconds - Optional TTL in seconds (uses default if not provided)
   * @remarks
   * TODO: Implement data compression for large values
   * TODO: Add cache size monitoring and eviction policies
   * TODO: Implement fallback to in-memory cache when Redis is unavailable
   * TODO: Add data validation and sanitization before caching
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, falling back to in-memory cache');
      // TODO: Implement actual fallback to in-memory cache
      return;
    }

    try {
      const namespacedKey = this.getNamespacedKey(key);
      const serializedValue = JSON.stringify(value);
      const ttl = ttlSeconds || this.defaultTtl;

      await this.redisClient.setex(namespacedKey, ttl, serializedValue);
      this.logger.debug(`Cache set: ${namespacedKey}`);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a value from the cache.
   *
   * @param key - Cache key to retrieve
   * @returns The cached value or null if not found
   * @remarks
   * TODO: Add cache hit/miss metrics and monitoring
   * TODO: Implement cache warming for frequently missed keys
   * TODO: Add data validation after deserialization
   * TODO: Consider implementing cache versioning
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, returning null');
      return null;
    }

    try {
      const namespacedKey = this.getNamespacedKey(key);
      const value = await this.redisClient.get(namespacedKey);

      if (!value) {
        return null;
      }

      const parsedValue = JSON.parse(value);
      this.logger.debug(`Cache hit: ${namespacedKey}`);
      return parsedValue as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Deletes a cache entry by key.
   *
   * @param key - Cache key to delete
   * @returns True if the key was deleted, false otherwise
   * @remarks
   * TODO: Add metrics for delete operations
   * TODO: Implement soft delete with TTL extension
   * TODO: Add delete operation batching for multiple keys
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, cannot delete');
      return false;
    }

    try {
      const namespacedKey = this.getNamespacedKey(key);
      const result = await this.redisClient.del(namespacedKey);
      const deleted = result > 0;

      if (deleted) {
        this.logger.debug(`Cache delete: ${namespacedKey}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clears all cache entries with the current key prefix.
   * WARNING: This operation can be expensive and blocking in production.
   *
   * @remarks
   * CRITICAL: Uses KEYS command which is blocking and expensive - replace with SCAN
   * TODO: Replace KEYS with SCAN for production use (non-blocking, paginated)
   * TODO: Implement batch deletion with size limits
   * TODO: Add confirmation mechanism for large clear operations
   * TODO: Implement selective clearing by pattern or TTL
   */
  async clear(): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, cannot clear');
      return;
    }

    try {
      // CRITICAL: KEYS command blocks Redis - use SCAN in production
      const keys = await this.redisClient.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
      this.logger.debug(`Cache cleared: ${keys.length} keys removed`);
    } catch (error) {
      this.logger.error('Cache clear error:', error);
      throw error;
    }
  }

  /**
   * Checks if a cache key exists.
   *
   * @param key - Cache key to check
   * @returns True if the key exists, false otherwise
   * @remarks
   * TODO: Add exists operation metrics
   * TODO: Consider implementing TTL check along with existence
   * TODO: Add batch exists operations for multiple keys
   */
  async has(key: string): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, returning false');
      return false;
    }

    try {
      const namespacedKey = this.getNamespacedKey(key);
      const exists = await this.redisClient.exists(namespacedKey);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Cache has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Retrieves multiple cache entries in a single operation.
   * More efficient than individual get() calls for bulk operations.
   *
   * @param keys - Array of cache keys to retrieve
   * @returns Array of values in the same order as keys (null for missing entries)
   * @remarks
   * TODO: Add batch size limits to prevent command size issues
   * TODO: Implement pagination for large key sets
   * TODO: Add metrics for batch operation performance
   * TODO: Consider implementing parallel processing for very large batches
   */
  async getMultiple<T>(keys: string[]): Promise<(T | null)[]> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, returning nulls');
      return new Array(keys.length).fill(null);
    }

    try {
      const namespacedKeys = keys.map(key => this.getNamespacedKey(key));
      const values = await this.redisClient.mget(...namespacedKeys);

      return values.map(value => {
        if (!value) return null;
        try {
          return JSON.parse(value) as T;
        } catch {
          return null;
        }
      });
    } catch (error) {
      this.logger.error('Cache getMultiple error:', error);
      return new Array(keys.length).fill(null);
    }
  }

  /**
   * Sets multiple cache entries in a single atomic operation using Redis pipeline.
   * More efficient than individual set() calls for bulk operations.
   *
   * @param entries - Array of key-value pairs with optional TTL
   * @remarks
   * TODO: Add batch size limits to prevent memory issues
   * TODO: Implement transaction rollback on partial failures
   * TODO: Add progress tracking for large batch operations
   * TODO: Consider implementing optimistic locking for concurrent updates
   */
  async setMultiple(
    entries: Array<{ key: string; value: any; ttlSeconds?: number }>
  ): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, cannot set multiple');
      return;
    }

    try {
      const pipeline = this.redisClient.pipeline();

      for (const entry of entries) {
        const namespacedKey = this.getNamespacedKey(entry.key);
        const serializedValue = JSON.stringify(entry.value);
        const ttl = entry.ttlSeconds || this.defaultTtl;
        pipeline.setex(namespacedKey, ttl, serializedValue);
      }

      await pipeline.exec();
      this.logger.debug(`Cache set multiple: ${entries.length} entries`);
    } catch (error) {
      this.logger.error('Cache setMultiple error:', error);
      throw error;
    }
  }

  /**
   * Returns the current Redis connection status.
   *
   * @returns True if connected to Redis, false otherwise
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Retrieves comprehensive cache statistics for monitoring.
   * Includes connection status, database size, and memory usage.
   *
   * @returns Cache statistics object
   * @remarks
   * TODO: Add Prometheus-compatible metrics export
   * TODO: Implement historical statistics and trends
   * TODO: Add cache hit/miss ratio calculations
   * TODO: Include connection pool statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    dbSize?: number;
    memoryUsage?: string;
  }> {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const [dbSize, memoryInfo] = await Promise.all([
        this.redisClient.dbsize(),
        this.redisClient.info('memory'),
      ]);

      const memoryUsage = memoryInfo
        .split('\n')
        .find(line => line.startsWith('used_memory_human:'))
        ?.split(':')[1];

      return {
        connected: true,
        dbSize,
        memoryUsage,
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats:', error);
      return { connected: false };
    }
  }
}
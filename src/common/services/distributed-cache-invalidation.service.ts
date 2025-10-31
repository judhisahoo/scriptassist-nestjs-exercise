import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Interface defining a cache invalidation strategy configuration
 */
export interface CacheInvalidationStrategy {
  /** Unique name identifier for the strategy */
  name: string;
  /** Redis key pattern to match for invalidation */
  pattern: string;
  /** Optional TTL for strategy-specific caching */
  ttl?: number;
  /** Optional dependent patterns that should also be invalidated */
  dependencies?: string[];
}

/**
 * Interface representing a cached entry with metadata
 */
export interface CacheEntry {
  /** Original cache key */
  key: string;
  /** Cached value */
  value: any;
  /** Associated tags for invalidation */
  tags: string[];
  /** Timestamp when entry was created */
  createdAt: number;
  /** Time-to-live in seconds */
  ttl: number;
}

/**
 * Service for distributed cache invalidation across multiple application instances.
 * Uses Redis pub/sub for cross-instance communication and tag-based invalidation.
 *
 * @remarks
 * This service provides:
 * - Tag-based cache invalidation
 * - Strategy-based invalidation patterns
 * - Distributed invalidation via Redis pub/sub
 * - Automatic cleanup and monitoring
 */
@Injectable()
export class DistributedCacheInvalidationService {
  private readonly logger = new Logger(DistributedCacheInvalidationService.name);

  /** Redis client instance for cache operations */
  private redisClient: Redis;

  /** Prefix for all cache keys to avoid collisions */
  private readonly cachePrefix = 'cache:';

  /** Prefix for tag-based cache relationships */
  private readonly tagPrefix = 'tag:';

  /** Redis pub/sub channel for invalidation messages */
  private readonly invalidationChannel = 'cache:invalidation';

  /** Map of registered invalidation strategies */
  private strategies: Map<string, CacheInvalidationStrategy> = new Map();

  /**
   * Creates an instance of DistributedCacheInvalidationService.
   *
   * @param configService - Service for accessing application configuration
   * @param distributedLockService - Service for distributed locking operations
   * @param injectedRedisClient - Optional pre-configured Redis client (for testing or shared instances)
   */
  constructor(
    private configService: ConfigService,
    private distributedLockService: DistributedLockService,
    @Optional() @Inject('REDIS_CLIENT') private injectedRedisClient?: Redis,
  ) {
    // Use injected Redis client if provided, otherwise initialize new connection
    if (this.injectedRedisClient) {
      this.redisClient = this.injectedRedisClient;
    } else {
      this.initializeRedis();
    }

    // Initialize default invalidation strategies and pub/sub subscriber
    this.initializeDefaultStrategies();
    this.setupInvalidationSubscriber();
  }

  /**
   * Initializes Redis client connection for cache operations.
   * Sets up event handlers for connection monitoring.
   *
   * @private
   * @remarks
   * TODO: Implement exponential backoff and circuit breaker pattern for connection failures
   * TODO: Add health checks and connection pooling for better resilience
   * TODO: Support Redis cluster and sentinel configurations
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
        this.logger.log('Distributed cache invalidation service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Distributed cache invalidation service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for cache invalidation:', error);
    }
  }

  /**
   * Initializes default cache invalidation strategies for common use cases.
   * These strategies define patterns and dependencies for efficient cache clearing.
   *
   * @private
   * @remarks
   * TODO: Extract strategy definitions to external configuration files
   * TODO: Implement strategy versioning and migration support
   * TODO: Add strategy validation and testing capabilities
   */
  private initializeDefaultStrategies() {
    // Task-related invalidation strategies - clear task caches and dependent user/project caches
    this.registerStrategy({
      name: 'task-updates',
      pattern: 'task:*',
      dependencies: ['user:tasks:*', 'project:tasks:*'],
    });

    // User-related invalidation strategies - clear user caches and dependent task/project caches
    this.registerStrategy({
      name: 'user-updates',
      pattern: 'user:*',
      dependencies: ['user:tasks:*', 'user:projects:*'],
    });

    // Project-related invalidation strategies - clear project caches and dependent task/member caches
    this.registerStrategy({
      name: 'project-updates',
      pattern: 'project:*',
      dependencies: ['project:tasks:*', 'project:members:*'],
    });

    // Generic strategies for list views and search results with shorter TTL
    this.registerStrategy({
      name: 'list-views',
      pattern: 'list:*',
      ttl: 300, // 5 minutes - frequently changing list data
    });

    this.registerStrategy({
      name: 'search-results',
      pattern: 'search:*',
      ttl: 600, // 10 minutes - search results can be cached longer
    });
  }

  /**
   * Sets up Redis pub/sub subscriber for cross-instance cache invalidation.
   * Listens for invalidation messages from other application instances.
   *
   * @private
   * @remarks
   * TODO: Implement batched invalidation messages for high-throughput scenarios
   * TODO: Add message queuing and retry mechanisms for failed deliveries
   * TODO: Consider Redis Streams for better message persistence and ordering
   * TODO: Implement proper subscriber cleanup in onModuleDestroy
   */
  private setupInvalidationSubscriber() {
    try {
      // Create separate Redis connection for pub/sub (required by Redis design)
      const subscriber = this.redisClient.duplicate();
      subscriber.subscribe(this.invalidationChannel);

      // Handle incoming invalidation messages from other instances
      subscriber.on('message', (channel, message) => {
        if (channel === this.invalidationChannel) {
          try {
            const invalidationData = JSON.parse(message);
            this.handleInvalidationMessage(invalidationData);
          } catch (error) {
            this.logger.error('Error processing invalidation message:', error);
          }
        }
      });

      this.logger.log('Cache invalidation subscriber setup complete');
    } catch (error) {
      this.logger.error('Failed to setup invalidation subscriber:', error);
    }
  }

  /**
   * Handles incoming invalidation messages from Redis pub/sub channel.
   * Processes different types of invalidation requests from other instances.
   *
   * @private
   * @param data - Invalidation message data containing type and parameters
   * @remarks
   * TODO: Add rate limiting for incoming invalidation messages
   * TODO: Implement message validation and sanitization
   * TODO: Add metrics for processed invalidation messages
   */
  private async handleInvalidationMessage(data: {
    /** Type of invalidation operation */
    type: string;
    /** Keys to invalidate (for invalidate_keys type) */
    keys?: string[];
    /** Tags to invalidate (for invalidate_tags type) */
    tags?: string[];
    /** Pattern to match (for invalidate_pattern type) */
    pattern?: string;
    /** Source instance identifier */
    source: string;
  }) {
    try {
      // Route invalidation request based on type
      switch (data.type) {
        case 'invalidate_keys':
          if (data.keys) {
            await this.invalidateKeys(data.keys);
          }
          break;
        case 'invalidate_tags':
          if (data.tags) {
            await this.invalidateByTags(data.tags);
          }
          break;
        case 'invalidate_pattern':
          if (data.pattern) {
            await this.invalidateByPattern(data.pattern);
          }
          break;
        default:
          this.logger.warn(`Unknown invalidation message type: ${data.type}`);
      }

      this.logger.debug(`Processed invalidation message from ${data.source}:`, data);
    } catch (error) {
      this.logger.error('Error handling invalidation message:', error);
    }
  }

  /**
   * Registers a new cache invalidation strategy.
   * Strategies define patterns and dependencies for coordinated cache clearing.
   *
   * @param strategy - The invalidation strategy configuration
   * @remarks
   * TODO: Add strategy validation (pattern syntax, dependency cycles)
   * TODO: Implement strategy hot-reloading from configuration
   * TODO: Add strategy metrics and usage tracking
   */
  registerStrategy(strategy: CacheInvalidationStrategy) {
    this.strategies.set(strategy.name, strategy);
    this.logger.log(`Cache invalidation strategy registered: ${strategy.name}`);
  }

  /**
   * Stores a cache entry with associated tags for efficient invalidation.
   * Creates both the cache entry and tag relationships in Redis.
   *
   * @param key - The cache key
   * @param value - The value to cache
   * @param tags - Array of tags for invalidation grouping
   * @param ttl - Time-to-live in seconds (default: 300)
   * @remarks
   * TODO: Implement atomic operations using Redis transactions
   * TODO: Add data compression for large values
   * TODO: Implement cache versioning to prevent stale overwrites
   * TODO: Add memory usage monitoring and alerts
   */
  async setWithTags(
    key: string,
    value: any,
    tags: string[] = [],
    ttl: number = 300,
  ): Promise<void> {
    const cacheKey = this.getCacheKey(key);
    const cacheEntry: CacheEntry = {
      key,
      value,
      tags,
      createdAt: Date.now(),
      ttl,
    };

    try {
      // Store the cache entry with TTL
      await this.redisClient.setex(cacheKey, ttl, JSON.stringify(cacheEntry));

      // Create tag relationships for efficient invalidation
      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        await this.redisClient.sadd(tagKey, cacheKey);
        await this.redisClient.expire(tagKey, ttl); // Tag sets expire with entries
      }

      this.logger.debug(`Cache set with tags: ${key}, tags: [${tags.join(', ')}]`);
    } catch (error) {
      this.logger.error(`Error setting cache with tags for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a cache entry by key, with TTL validation.
   *
   * @param key - The cache key to retrieve
   * @returns The cached value or null if not found/expired
   * @remarks
   * TODO: Use Redis TTL commands instead of manual timestamp checks to avoid race conditions
   * TODO: Implement cache versioning to prevent serving stale data
   * TODO: Add cache hit/miss metrics and monitoring
   * TODO: Consider implementing cache warming for frequently missed keys
   */
  async get(key: string): Promise<any | null> {
    const cacheKey = this.getCacheKey(key);

    try {
      const data = await this.redisClient.get(cacheKey);
      if (!data) return null;

      const entry: CacheEntry = JSON.parse(data);

      // Manual TTL check - TODO: Replace with Redis TTL for atomic operations
      if (Date.now() - entry.createdAt > entry.ttl * 1000) {
        await this.invalidateKeys([key]); // Race condition potential here
        return null;
      }

      this.logger.debug(`Cache hit: ${key}`);
      return entry.value;
    } catch (error) {
      this.logger.error(`Error getting cache entry for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Invalidates specific cache keys and broadcasts the invalidation to other instances.
   *
   * @param keys - Array of cache keys to invalidate
   * @remarks
   * TODO: Implement batching for large key sets to avoid command size limits
   * TODO: Add retry logic for failed invalidation operations
   * TODO: Implement metrics for invalidation success/failure rates
   * TODO: Consider using Redis pipelines for atomic multi-key operations
   */
  async invalidateKeys(keys: string[]): Promise<void> {
    const cacheKeys = keys.map(key => this.getCacheKey(key));

    try {
      // Delete cache entries
      if (cacheKeys.length > 0) {
        await this.redisClient.del(...cacheKeys);
      }

      // Broadcast invalidation to other application instances
      await this.publishInvalidation({
        type: 'invalidate_keys',
        keys,
        source: this.getInstanceId(),
      });

      this.logger.debug(`Invalidated keys: [${keys.join(', ')}]`);
    } catch (error) {
      this.logger.error('Error invalidating keys:', error);
      throw error;
    }
  }

  /**
   * Invalidates all cache entries associated with the specified tags.
   * Uses tag-to-key mappings for efficient bulk invalidation.
   *
   * @param tags - Array of tags to invalidate
   * @remarks
   * TODO: Implement periodic cleanup of orphaned tag sets
   * TODO: Add memory usage monitoring for tag sets
   * TODO: Consider using Redis sets with TTL for automatic cleanup
   * TODO: Implement tag relationship validation to prevent cycles
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      const keysToInvalidate: string[] = [];

      // Collect all keys associated with each tag
      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        const cacheKeys = await this.redisClient.smembers(tagKey);

        // Convert cache keys back to original keys
        const originalKeys = cacheKeys.map(cacheKey =>
          cacheKey.replace(this.cachePrefix, '')
        );

        keysToInvalidate.push(...originalKeys);

        // Clean up the tag set after collecting keys
        await this.redisClient.del(tagKey);
      }

      // Remove duplicates and invalidate collected keys
      if (keysToInvalidate.length > 0) {
        await this.invalidateKeys([...new Set(keysToInvalidate)]);
      }

      this.logger.debug(`Invalidated by tags: [${tags.join(', ')}]`);
    } catch (error) {
      this.logger.error('Error invalidating by tags:', error);
      throw error;
    }
  }

  /**
   * Invalidates cache entries matching a Redis key pattern.
   * Uses Redis KEYS command to find matching keys.
   *
   * @param pattern - Redis key pattern (e.g., "user:*", "task:123:*")
   * @remarks
   * CRITICAL: KEYS command is blocking and expensive in production - replace with SCAN
   * TODO: Replace KEYS with SCAN for production use (non-blocking, paginated)
   * TODO: Implement pagination for large result sets
   * TODO: Add rate limiting for pattern-based invalidations
   * TODO: Consider using Redis sets for pre-computed pattern groups
   */
  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      // CRITICAL: KEYS command blocks Redis and is O(n) - replace with SCAN in production
      const keys = await this.redisClient.keys(this.getCacheKey(pattern));
      const originalKeys = keys.map(key => key.replace(this.cachePrefix, ''));

      if (originalKeys.length > 0) {
        await this.invalidateKeys(originalKeys);
      }

      this.logger.debug(`Invalidated by pattern: ${pattern} (${originalKeys.length} keys)`);
    } catch (error) {
      this.logger.error(`Error invalidating by pattern ${pattern}:`, error);
      throw error;
    }
  }

  /**
   * Executes a predefined invalidation strategy with distributed locking.
   * Ensures coordinated invalidation across multiple instances.
   *
   * @param strategyName - Name of the registered strategy to execute
   * @param context - Optional context data (currently unused)
   * @remarks
   * TODO: Implement strategy versioning and migration
   * TODO: Add strategy execution metrics and monitoring
   * TODO: Implement strategy dependency graph validation
   * TODO: Add strategy execution timeout and cancellation
   */
  async invalidateByStrategy(strategyName: string, context?: any): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Unknown invalidation strategy: ${strategyName}`);
    }

    try {
      // Acquire distributed lock to prevent concurrent strategy execution
      const lockKey = `invalidation:${strategyName}`;
      const lockValue = await this.distributedLockService.acquireLock(
        lockKey,
        this.getInstanceId(),
        { ttl: 10000 }, // 10 seconds lock TTL
      );

      if (lockValue) {
        try {
          // Execute main pattern invalidation
          await this.invalidateByPattern(strategy.pattern);

          // Execute dependency invalidations
          if (strategy.dependencies) {
            for (const dependency of strategy.dependencies) {
              await this.invalidateByPattern(dependency);
            }
          }

          this.logger.log(`Invalidated using strategy: ${strategyName}`);
        } finally {
          // Always release the lock
          await this.distributedLockService.releaseLock(lockKey, lockValue);
        }
      } else {
        this.logger.debug(`Strategy ${strategyName} already running on another instance`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating with strategy ${strategyName}:`, error);
      throw error;
    }
  }

  /**
   * Pre-populates cache with frequently accessed data entries.
   * Useful for improving cold start performance and reducing database load.
   *
   * @param entries - Array of cache entries to warm up
   * @remarks
   * TODO: Implement priority-based cache warming with background processing
   * TODO: Add cache warming metrics and success/failure tracking
   * TODO: Implement incremental warming for large datasets
   * TODO: Add warming strategy configuration and scheduling
   */
  async warmupCache(
    entries: Array<{ key: string; value: any; tags?: string[]; ttl?: number }>,
  ): Promise<void> {
    try {
      // Process entries sequentially to avoid overwhelming Redis
      for (const entry of entries) {
        await this.setWithTags(
          entry.key,
          entry.value,
          entry.tags || [],
          entry.ttl || 300,
        );
      }

      this.logger.log(`Cache warmup completed for ${entries.length} entries`);
    } catch (error) {
      this.logger.error('Error during cache warmup:', error);
      throw error;
    }
  }

  /**
   * Retrieves comprehensive cache statistics for monitoring and debugging.
   * Includes key counts, tag sets, and memory usage information.
   *
   * @returns Cache statistics object
   * @remarks
   * CRITICAL: Uses KEYS command which is blocking - replace with INFO command alternatives
   * TODO: Replace KEYS with INFO/memory commands for better performance
   * TODO: Add Prometheus-compatible metrics export
   * TODO: Implement historical statistics and trends
   * TODO: Add cache hit/miss ratio calculations
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    tagSets: number;
    memoryUsage?: string;
  }> {
    try {
      // CRITICAL: KEYS commands are blocking - use INFO/memory for production
      const [totalKeys, tagSets] = await Promise.all([
        this.redisClient.keys(`${this.cachePrefix}*`).then(keys => keys.length),
        this.redisClient.keys(`${this.tagPrefix}*`).then(keys => keys.length),
      ]);

      let memoryUsage: string | undefined;
      try {
        // Get memory information from Redis INFO command
        const memoryInfo = await this.redisClient.info('memory');
        memoryUsage = memoryInfo
          .split('\n')
          .find(line => line.startsWith('used_memory_human:'))
          ?.split(':')[1];
      } catch {
        // Memory info not available or command failed
      }

      return {
        totalKeys,
        tagSets,
        memoryUsage,
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return { totalKeys: 0, tagSets: 0 };
    }
  }

  /**
   * Publishes invalidation messages to the Redis pub/sub channel.
   * Allows other application instances to react to cache changes.
   *
   * @private
   * @param data - Invalidation message data
   * @remarks
   * TODO: Implement message batching for high-throughput scenarios
   * TODO: Add message persistence and retry mechanisms
   * TODO: Implement dead letter queue for failed message deliveries
   */
  private async publishInvalidation(data: any): Promise<void> {
    try {
      await this.redisClient.publish(this.invalidationChannel, JSON.stringify(data));
    } catch (error) {
      this.logger.error('Error publishing invalidation message:', error);
    }
  }

  /**
   * Generates a prefixed cache key to avoid collisions.
   *
   * @private
   * @param key - Original cache key
   * @returns Prefixed cache key
   */
  private getCacheKey(key: string): string {
    return `${this.cachePrefix}${key}`;
  }

  /**
   * Generates a prefixed tag key for tag-to-key mappings.
   *
   * @private
   * @param tag - Tag name
   * @returns Prefixed tag key
   */
  private getTagKey(tag: string): string {
    return `${this.tagPrefix}${tag}`;
  }

  /**
   * Generates a unique instance identifier for distributed operations.
   *
   * @private
   * @returns Unique instance ID
   */
  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  /**
   * Lifecycle hook called when the module is being destroyed.
   * Ensures proper cleanup of Redis connections and resources.
   *
   * @remarks
   * CRITICAL: Subscriber connections are not being cleaned up
   * TODO: Properly close subscriber connections in setupInvalidationSubscriber
   * TODO: Implement graceful shutdown with pending operations handling
   * TODO: Add connection pool draining and resource cleanup
   */
  async onModuleDestroy() {
    if (this.redisClient && !this.injectedRedisClient) {
      await this.redisClient.quit();
    }
  }
}
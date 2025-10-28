import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DistributedLockService } from './distributed-lock.service';

export interface CacheInvalidationStrategy {
  name: string;
  pattern: string;
  ttl?: number;
  dependencies?: string[];
}

export interface CacheEntry {
  key: string;
  value: any;
  tags: string[];
  createdAt: number;
  ttl: number;
}

@Injectable()
export class DistributedCacheInvalidationService {
  private readonly logger = new Logger(DistributedCacheInvalidationService.name);
  private redisClient: Redis;
  private readonly cachePrefix = 'cache:';
  private readonly tagPrefix = 'tag:';
  private readonly invalidationChannel = 'cache:invalidation';
  private strategies: Map<string, CacheInvalidationStrategy> = new Map();

  constructor(
    private configService: ConfigService,
    private distributedLockService: DistributedLockService,
    @Optional() @Inject('REDIS_CLIENT') private injectedRedisClient?: Redis,
  ) {
    if (this.injectedRedisClient) {
      this.redisClient = this.injectedRedisClient;
    } else {
      this.initializeRedis();
    }

    this.initializeDefaultStrategies();
    this.setupInvalidationSubscriber();
  }

  private initializeRedis() {
    try {
      const redisConfig = {
        host: this.configService.get('redis.host', 'localhost'),
        port: this.configService.get('redis.port', 6379),
        password: this.configService.get('redis.password'),
        db: this.configService.get('redis.db', 0),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      this.redisClient = new Redis(redisConfig);

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

  private initializeDefaultStrategies() {
    // Task-related invalidation strategies
    this.registerStrategy({
      name: 'task-updates',
      pattern: 'task:*',
      dependencies: ['user:tasks:*', 'project:tasks:*'],
    });

    this.registerStrategy({
      name: 'user-updates',
      pattern: 'user:*',
      dependencies: ['user:tasks:*', 'user:projects:*'],
    });

    this.registerStrategy({
      name: 'project-updates',
      pattern: 'project:*',
      dependencies: ['project:tasks:*', 'project:members:*'],
    });

    // Generic strategies
    this.registerStrategy({
      name: 'list-views',
      pattern: 'list:*',
      ttl: 300, // 5 minutes
    });

    this.registerStrategy({
      name: 'search-results',
      pattern: 'search:*',
      ttl: 600, // 10 minutes
    });
  }

  private setupInvalidationSubscriber() {
    try {
      const subscriber = this.redisClient.duplicate();
      subscriber.subscribe(this.invalidationChannel);

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

  private async handleInvalidationMessage(data: {
    type: string;
    keys?: string[];
    tags?: string[];
    pattern?: string;
    source: string;
  }) {
    try {
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
      }

      this.logger.debug(`Processed invalidation message from ${data.source}:`, data);
    } catch (error) {
      this.logger.error('Error handling invalidation message:', error);
    }
  }

  registerStrategy(strategy: CacheInvalidationStrategy) {
    this.strategies.set(strategy.name, strategy);
    this.logger.log(`Cache invalidation strategy registered: ${strategy.name}`);
  }

  /**
   * Set cache entry with tags for invalidation
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
      // Store the cache entry
      await this.redisClient.setex(cacheKey, ttl, JSON.stringify(cacheEntry));

      // Store tag relationships
      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        await this.redisClient.sadd(tagKey, cacheKey);
        await this.redisClient.expire(tagKey, ttl);
      }

      this.logger.debug(`Cache set with tags: ${key}, tags: [${tags.join(', ')}]`);
    } catch (error) {
      this.logger.error(`Error setting cache with tags for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get cache entry
   */
  async get(key: string): Promise<any | null> {
    const cacheKey = this.getCacheKey(key);

    try {
      const data = await this.redisClient.get(cacheKey);
      if (!data) return null;

      const entry: CacheEntry = JSON.parse(data);

      // Check if entry is still valid
      if (Date.now() - entry.createdAt > entry.ttl * 1000) {
        await this.invalidateKeys([key]);
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
   * Invalidate cache by keys
   */
  async invalidateKeys(keys: string[]): Promise<void> {
    const cacheKeys = keys.map(key => this.getCacheKey(key));

    try {
      if (cacheKeys.length > 0) {
        await this.redisClient.del(...cacheKeys);
      }

      // Publish invalidation message for other instances
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
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      const keysToInvalidate: string[] = [];

      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        const cacheKeys = await this.redisClient.smembers(tagKey);

        // Get original keys (remove cache prefix)
        const originalKeys = cacheKeys.map(cacheKey =>
          cacheKey.replace(this.cachePrefix, '')
        );

        keysToInvalidate.push(...originalKeys);

        // Clean up tag set
        await this.redisClient.del(tagKey);
      }

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
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<void> {
    try {
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
   * Invalidate using predefined strategy
   */
  async invalidateByStrategy(strategyName: string, context?: any): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Unknown invalidation strategy: ${strategyName}`);
    }

    try {
      // Use distributed lock to ensure only one instance performs invalidation
      const lockKey = `invalidation:${strategyName}`;
      const lockValue = await this.distributedLockService.acquireLock(
        lockKey,
        this.getInstanceId(),
        { ttl: 10000 }, // 10 seconds
      );

      if (lockValue) {
        try {
          // Invalidate main pattern
          await this.invalidateByPattern(strategy.pattern);

          // Invalidate dependencies
          if (strategy.dependencies) {
            for (const dependency of strategy.dependencies) {
              await this.invalidateByPattern(dependency);
            }
          }

          this.logger.log(`Invalidated using strategy: ${strategyName}`);
        } finally {
          await this.distributedLockService.releaseLock(lockKey, lockValue);
        }
      }
    } catch (error) {
      this.logger.error(`Error invalidating with strategy ${strategyName}:`, error);
      throw error;
    }
  }

  /**
   * Warm up cache for frequently accessed data
   */
  async warmupCache(
    entries: Array<{ key: string; value: any; tags?: string[]; ttl?: number }>,
  ): Promise<void> {
    try {
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
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    tagSets: number;
    memoryUsage?: string;
  }> {
    try {
      const [totalKeys, tagSets] = await Promise.all([
        this.redisClient.keys(`${this.cachePrefix}*`).then(keys => keys.length),
        this.redisClient.keys(`${this.tagPrefix}*`).then(keys => keys.length),
      ]);

      let memoryUsage: string | undefined;
      try {
        const memoryInfo = await this.redisClient.info('memory');
        memoryUsage = memoryInfo
          .split('\n')
          .find(line => line.startsWith('used_memory_human:'))
          ?.split(':')[1];
      } catch {
        // Memory info not available
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

  private async publishInvalidation(data: any): Promise<void> {
    try {
      await this.redisClient.publish(this.invalidationChannel, JSON.stringify(data));
    } catch (error) {
      this.logger.error('Error publishing invalidation message:', error);
    }
  }

  private getCacheKey(key: string): string {
    return `${this.cachePrefix}${key}`;
  }

  private getTagKey(tag: string): string {
    return `${this.tagPrefix}${tag}`;
  }

  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  async onModuleDestroy() {
    if (this.redisClient && !this.injectedRedisClient) {
      await this.redisClient.quit();
    }
  }
}
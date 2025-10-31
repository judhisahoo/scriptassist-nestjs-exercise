import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { PerformanceOptimizationService } from './performance-optimization.service';

/**
 * Defines the configuration for a cache strategy including TTL, size limits,
 * eviction policies, and data transformation options.
 */
export interface CacheStrategy {
  /** Unique name identifier for the cache strategy */
  name: string;
  /** Time-to-live in seconds for cached entries */
  ttl: number;
  /** Maximum number of entries allowed in this strategy's cache */
  maxSize?: number;
  /** Eviction policy: 'lru' (Least Recently Used), 'lfu' (Least Frequently Used), 'ttl' (Time-based), or 'adaptive' */
  evictionPolicy: 'lru' | 'lfu' | 'ttl' | 'adaptive';
  /** Whether to compress cached data to save memory */
  compression?: boolean;
  /** Serialization format: 'json', 'msgpack', or 'none' for raw data */
  serialization?: 'json' | 'msgpack' | 'none';
}

/**
 * Represents a cached entry with comprehensive metadata for advanced caching strategies.
 * Tracks usage patterns, lifecycle, and performance metrics for intelligent cache management.
 */
export interface CacheEntry {
  /** The cache key identifier */
  key: string;
  /** The cached value (can be any serializable data) */
  value: any;
  /** Metadata containing usage statistics and cache management information */
  metadata: {
    /** Number of times this entry has been accessed */
    hits: number;
    /** Timestamp of the last access to this entry */
    lastAccessed: number;
    /** Timestamp when this entry was created */
    createdAt: number;
    /** Time-to-live in seconds for this entry */
    ttl: number;
    /** Memory size of the cached value in bytes */
    size: number;
    /** Name of the cache strategy used for this entry */
    strategy: string;
  };
}

/**
 * Comprehensive metrics for monitoring cache performance and health.
 * Tracks hit rates, memory usage, and operational statistics for cache optimization.
 */
export interface CacheMetrics {
  /** Total number of cache requests (hits + misses) */
  totalRequests: number;
  /** Number of successful cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit rate as a percentage (0-100) */
  hitRate: number;
  /** Number of entries evicted due to capacity limits */
  evictions: number;
  /** Current memory usage of the cache in bytes */
  memoryUsage: number;
  /** Average response time for cache operations in milliseconds */
  averageResponseTime: number;
}

/**
 * Advanced caching service that provides multiple caching strategies with intelligent
 * eviction policies, compression, and performance monitoring. Supports different TTL
 * configurations and adaptive caching based on access patterns.
 *
 * Features:
 * - Multiple cache strategies (high-throughput, low-latency, long-term, adaptive)
 * - Intelligent eviction policies (LRU, LFU, TTL-based, adaptive)
 * - Data compression and serialization options
 * - Comprehensive metrics and monitoring
 * - Automatic cleanup and optimization
 */
@Injectable()
export class AdvancedCacheService implements OnModuleInit {
  private readonly logger = new Logger(AdvancedCacheService.name);
  /** Map of registered cache strategies by name */
  private strategies: Map<string, CacheStrategy> = new Map();
  /** Map of cached entries with their metadata */
  private cacheEntries: Map<string, CacheEntry> = new Map();
  /** Performance and usage metrics for monitoring */
  private metrics: CacheMetrics = {
    totalRequests: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    evictions: 0,
    memoryUsage: 0,
    averageResponseTime: 0,
  };

  /** Interval for periodic cache cleanup */
  private cleanupInterval: NodeJS.Timeout;
  /** Interval for metrics collection and logging */
  private metricsInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    private basicCacheService: CacheService,
    private performanceService: PerformanceOptimizationService,
  ) {}

  /**
   * Initializes the advanced cache service by setting up default strategies,
   * starting cleanup routines, and beginning metrics collection.
   */
  async onModuleInit() {
    this.initializeStrategies();
    this.startCleanupRoutine();
    this.startMetricsCollection();
    this.logger.log('Advanced cache service initialized');
  }

  /**
   * Initializes the default cache strategies optimized for different use cases.
   * Each strategy is configured with appropriate TTL, size limits, and eviction policies.
   */
  private initializeStrategies() {
    // High-throughput strategy for frequently accessed data
    this.registerStrategy({
      name: 'high-throughput',
      ttl: 300, // 5 minutes
      maxSize: 10000,
      evictionPolicy: 'lru',
      compression: true,
      serialization: 'json',
    });

    // Low-latency strategy for critical data requiring minimal access time
    this.registerStrategy({
      name: 'low-latency',
      ttl: 60, // 1 minute
      maxSize: 5000,
      evictionPolicy: 'lfu',
      compression: false,
      serialization: 'none',
    });

    // Long-term strategy for stable data that doesn't change frequently
    this.registerStrategy({
      name: 'long-term',
      ttl: 3600, // 1 hour
      maxSize: 50000,
      evictionPolicy: 'ttl',
      compression: true,
      serialization: 'msgpack',
    });

    // Adaptive strategy that adjusts based on load and access patterns
    this.registerStrategy({
      name: 'adaptive',
      ttl: 180, // 3 minutes
      maxSize: 20000,
      evictionPolicy: 'adaptive',
      compression: true,
      serialization: 'json',
    });
  }

  /**
   * Registers a new cache strategy for use by the advanced cache service.
   * Strategies define how different types of data should be cached and evicted.
   *
   * @param strategy - The cache strategy configuration to register
   */
  registerStrategy(strategy: CacheStrategy) {
    this.strategies.set(strategy.name, strategy);
    this.logger.log(`Cache strategy registered: ${strategy.name}`);
  }

  /**
   * Retrieves a value from the cache using the specified strategy.
   * Implements multi-level cache lookup with fallback to basic cache service.
   *
   * @param key - The cache key to retrieve
   * @param strategyName - The cache strategy to use (defaults to 'adaptive')
   * @returns The cached value or null if not found or expired
   */
  async get<T>(key: string, strategyName: string = 'adaptive'): Promise<T | null> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      const strategy = this.strategies.get(strategyName);
      if (!strategy) {
        throw new Error(`Unknown cache strategy: ${strategyName}`);
      }

      // Try to get from advanced cache first
      const entry = this.cacheEntries.get(this.getStrategyKey(key, strategyName));
      if (entry) {
        // Check if entry is still valid
        if (Date.now() - entry.metadata.createdAt < entry.metadata.ttl * 1000) {
          entry.metadata.hits++;
          entry.metadata.lastAccessed = Date.now();

          this.metrics.hits++;
          this.updateHitRate();

          const responseTime = Date.now() - startTime;
          this.metrics.averageResponseTime =
            (this.metrics.averageResponseTime + responseTime) / 2;

          this.logger.debug(`Cache hit for key: ${key} using strategy: ${strategyName}`);
          return entry.value as T;
        } else {
          // Entry expired, remove it
          this.cacheEntries.delete(this.getStrategyKey(key, strategyName));
        }
      }

      // Fallback to basic cache service
      const fallbackValue = await this.basicCacheService.get<T>(key);
      if (fallbackValue !== null) {
        // Store in advanced cache for future requests
        await this.set(key, fallbackValue, strategyName);
        this.metrics.hits++;
        this.updateHitRate();
        return fallbackValue;
      }

      this.metrics.misses++;
      this.updateHitRate();

      const responseTime = Date.now() - startTime;
      this.metrics.averageResponseTime =
        (this.metrics.averageResponseTime + responseTime) / 2;

      return null;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key}:`, error);
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Stores a value in the cache using the specified strategy.
   * Applies compression and serialization based on strategy configuration.
   *
   * @param key - The cache key to store the value under
   * @param value - The value to cache (will be serialized based on strategy)
   * @param strategyName - The cache strategy to use (defaults to 'adaptive')
   * @param customTtl - Optional custom TTL to override strategy default
   */
  async set(
    key: string,
    value: any,
    strategyName: string = 'adaptive',
    customTtl?: number,
  ): Promise<void> {
    try {
      const strategy = this.strategies.get(strategyName);
      if (!strategy) {
        throw new Error(`Unknown cache strategy: ${strategyName}`);
      }

      const ttl = customTtl || strategy.ttl;
      const strategyKey = this.getStrategyKey(key, strategyName);

      // Check size limits
      if (this.cacheEntries.size >= (strategy.maxSize || 10000)) {
        await this.evictEntries(strategyName);
      }

      // Compress and serialize if configured
      let processedValue = value;
      let size = this.calculateSize(value);

      if (strategy.compression) {
        processedValue = await this.compress(value);
        size = this.calculateSize(processedValue);
      }

      const entry: CacheEntry = {
        key,
        value: processedValue,
        metadata: {
          hits: 0,
          lastAccessed: Date.now(),
          createdAt: Date.now(),
          ttl,
          size,
          strategy: strategyName,
        },
      };

      this.cacheEntries.set(strategyKey, entry);
      this.metrics.memoryUsage = this.calculateTotalMemoryUsage();

      // Also store in basic cache as fallback
      await this.basicCacheService.set(key, value, ttl);

      this.logger.debug(`Cache set for key: ${key} using strategy: ${strategyName}`);
    } catch (error) {
      this.logger.error(`Error setting cache key ${key}:`, error);
      // Fallback to basic cache
      await this.basicCacheService.set(key, value, customTtl || 300);
    }
  }

  /**
   * Removes a cached value by key from the specified strategy or all strategies.
   *
   * @param key - The cache key to delete
   * @param strategyName - Optional strategy name; if not provided, deletes from all strategies
   * @returns True if the key was found and deleted, false otherwise
   */
  async delete(key: string, strategyName?: string): Promise<boolean> {
    try {
      let deleted = false;

      if (strategyName) {
        const strategyKey = this.getStrategyKey(key, strategyName);
        deleted = this.cacheEntries.delete(strategyKey);
      } else {
        // Delete from all strategies
        for (const strategy of this.strategies.keys()) {
          const strategyKey = this.getStrategyKey(key, strategy);
          if (this.cacheEntries.delete(strategyKey)) {
            deleted = true;
          }
        }
      }

      // Also delete from basic cache
      await this.basicCacheService.delete(key);

      if (deleted) {
        this.metrics.memoryUsage = this.calculateTotalMemoryUsage();
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clears all cached entries for a specific strategy or all strategies.
   * Updates memory usage metrics after clearing.
   *
   * @param strategyName - Optional strategy name; if not provided, clears all strategies
   */
  async clear(strategyName?: string): Promise<void> {
    try {
      if (strategyName) {
        const strategy = this.strategies.get(strategyName);
        if (!strategy) return;

        // Remove all entries for this strategy
        for (const [key, entry] of this.cacheEntries) {
          if (entry.metadata.strategy === strategyName) {
            this.cacheEntries.delete(key);
          }
        }
      } else {
        this.cacheEntries.clear();
      }

      this.metrics.memoryUsage = this.calculateTotalMemoryUsage();
      this.metrics.evictions += this.cacheEntries.size;

      this.logger.log(`Cache cleared for strategy: ${strategyName || 'all'}`);
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  /**
   * Retrieves comprehensive statistics about cache performance and usage.
   * Provides insights into hit rates, strategy performance, and memory usage.
   *
   * @returns Detailed cache statistics including overall metrics and per-strategy breakdowns
   */
  getCacheStatistics() {
    const strategyStats: Record<string, any> = {};

    for (const [strategyName, strategy] of this.strategies) {
      const strategyEntries = Array.from(this.cacheEntries.values()).filter(
        entry => entry.metadata.strategy === strategyName
      );

      const totalHits = strategyEntries.reduce((sum, entry) => sum + entry.metadata.hits, 0);
      const totalSize = strategyEntries.reduce((sum, entry) => sum + entry.metadata.size, 0);
      const avgTtl = strategyEntries.length > 0
        ? strategyEntries.reduce((sum, entry) => sum + entry.metadata.ttl, 0) / strategyEntries.length
        : 0;

      strategyStats[strategyName] = {
        entries: strategyEntries.length,
        totalHits,
        totalSize,
        averageTtl: Math.round(avgTtl),
        hitRate: strategyEntries.length > 0 ? totalHits / strategyEntries.length : 0,
      };
    }

    return {
      overall: { ...this.metrics },
      strategies: strategyStats,
      totalEntries: this.cacheEntries.size,
      strategiesCount: this.strategies.size,
    };
  }

  /**
   * Pre-populates the cache with frequently accessed data to improve initial performance.
   * This method loads mock data for demonstration; in production, it should load real frequently accessed data.
   *
   * @param strategyName - The cache strategy to use for warmup data (defaults to 'high-throughput')
   */
  async warmupCache(strategyName: string = 'high-throughput'): Promise<void> {
    try {
      this.logger.log(`Starting cache warmup for strategy: ${strategyName}`);

      // This would typically load frequently accessed data
      // For demonstration, we'll warm up with some mock data
      const warmupData = [
        { key: 'frequent_data_1', value: { data: 'frequently accessed data 1' } },
        { key: 'frequent_data_2', value: { data: 'frequently accessed data 2' } },
        { key: 'frequent_data_3', value: { data: 'frequently accessed data 3' } },
      ];

      for (const item of warmupData) {
        await this.set(item.key, item.value, strategyName, 1800); // 30 minutes
      }

      this.logger.log(`Cache warmup completed for strategy: ${strategyName}`);
    } catch (error) {
      this.logger.error('Error during cache warmup:', error);
    }
  }

  /**
   * Dynamically adjusts cache sizes based on current system load and performance metrics.
   * Scales cache capacities up during high throughput and down during low utilization.
   */
  async adaptiveCacheSizing() {
    const perfMetrics = this.performanceService.getMetrics();

    // Adjust cache sizes based on throughput and memory usage
    if (perfMetrics.throughput > 100) {
      // High throughput - increase cache sizes
      for (const [strategyName, strategy] of this.strategies) {
        if (strategy.evictionPolicy === 'adaptive') {
          const newMaxSize = Math.min((strategy.maxSize || 10000) * 1.2, 100000);
          strategy.maxSize = newMaxSize;
          this.logger.debug(`Increased cache size for ${strategyName} to ${newMaxSize}`);
        }
      }
    } else if (perfMetrics.memoryUsage > 400) {
      // High memory usage - reduce cache sizes
      for (const [strategyName, strategy] of this.strategies) {
        if (strategy.evictionPolicy === 'adaptive') {
          const newMaxSize = Math.max((strategy.maxSize || 10000) * 0.8, 1000);
          strategy.maxSize = newMaxSize;
          this.logger.debug(`Decreased cache size for ${strategyName} to ${newMaxSize}`);
        }
      }
    }
  }

  /**
   * Generates a namespaced key for storing cache entries under a specific strategy.
   * This prevents key collisions between different cache strategies.
   *
   * @param key - The original cache key
   * @param strategyName - The strategy name to namespace the key
   * @returns A namespaced key in the format "strategyName:key"
   */
  private getStrategyKey(key: string, strategyName: string): string {
    return `${strategyName}:${key}`;
  }

  /**
   * Evicts cache entries based on the strategy's eviction policy when capacity limits are reached.
   * Different policies (LRU, LFU, TTL, Adaptive) determine which entries are removed.
   *
   * @param strategyName - The name of the strategy to evict entries from
   */
  private async evictEntries(strategyName: string) {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return;

    const strategyEntries = Array.from(this.cacheEntries.entries()).filter(
      ([, entry]) => entry.metadata.strategy === strategyName,
    );

    if (strategyEntries.length === 0) return;

    let entriesToEvict: string[] = [];

    switch (strategy.evictionPolicy) {
      case 'lru':
        // Evict least recently used entries
        entriesToEvict = strategyEntries
          .sort(([, a], [, b]) => a.metadata.lastAccessed - b.metadata.lastAccessed)
          .slice(0, Math.floor(strategyEntries.length * 0.1))
          .map(([key]) => key);
        break;

      case 'lfu':
        // Evict least frequently used entries
        entriesToEvict = strategyEntries
          .sort(([, a], [, b]) => a.metadata.hits - b.metadata.hits)
          .slice(0, Math.floor(strategyEntries.length * 0.1))
          .map(([key]) => key);
        break;

      case 'ttl':
        // Evict expired entries based on TTL
        const now = Date.now();
        entriesToEvict = strategyEntries
          .filter(([, entry]) => now - entry.metadata.createdAt >= entry.metadata.ttl * 1000)
          .map(([key]) => key);
        break;

      case 'adaptive':
        // Adaptive eviction based on access patterns and frequency
        entriesToEvict = strategyEntries
          .sort(([, a], [, b]) => {
            const scoreA = (Date.now() - a.metadata.lastAccessed) / (a.metadata.hits + 1);
            const scoreB = (Date.now() - b.metadata.lastAccessed) / (b.metadata.hits + 1);
            return scoreA - scoreB;
          })
          .slice(0, Math.floor(strategyEntries.length * 0.1))
          .map(([key]) => key);
        break;
    }

    entriesToEvict.forEach(key => {
      this.cacheEntries.delete(key);
      this.metrics.evictions++;
    });

    if (entriesToEvict.length > 0) {
      this.logger.debug(`Evicted ${entriesToEvict.length} entries from ${strategyName} cache`);
    }
  }

  /**
   * Calculates the memory size of a value by serializing it to JSON.
   * Used for tracking memory usage and enforcing cache size limits.
   *
   * @param value - The value to calculate size for
   * @returns The size in bytes, or 0 if serialization fails
   */
  private calculateSize(value: any): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  /**
   * Calculates the total memory usage across all cached entries.
   * Used for monitoring and enforcing memory limits.
   *
   * @returns Total memory usage in bytes
   */
  private calculateTotalMemoryUsage(): number {
    let totalSize = 0;
    for (const entry of this.cacheEntries.values()) {
      totalSize += entry.metadata.size;
    }
    return totalSize;
  }

  /**
   * Placeholder for data compression functionality.
   * In a production implementation, this would use a proper compression library
   * like zlib or brotli to reduce memory usage for large cached values.
   *
   * @param value - The value to compress
   * @returns The compressed value (currently returns uncompressed for simplicity)
   */
  private async compress(value: any): Promise<any> {
    // Simple compression - in real implementation, use proper compression library
    // For now, just return the value as-is
    return value;
  }

  /**
   * Updates the cache hit rate percentage based on current hit and miss counts.
   * Used for monitoring cache effectiveness and performance optimization.
   */
  private updateHitRate() {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;
  }

  /**
   * Starts the periodic cleanup routine that removes expired cache entries.
   * Runs every 5 minutes to maintain cache health and prevent memory leaks.
   */
  private startCleanupRoutine() {
    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup();
    }, 300000); // Every 5 minutes
  }

  /**
   * Performs periodic cleanup of expired cache entries and triggers adaptive cache sizing.
   * This method is called automatically by the cleanup routine at regular intervals.
   */
  private async performCleanup() {
    try {
      // Clean expired entries based on TTL
      const now = Date.now();
      const expiredKeys: string[] = [];

      for (const [key, entry] of this.cacheEntries) {
        if (now - entry.metadata.createdAt >= entry.metadata.ttl * 1000) {
          expiredKeys.push(key);
        }
      }

      expiredKeys.forEach(key => {
        this.cacheEntries.delete(key);
        this.metrics.evictions++;
      });

      if (expiredKeys.length > 0) {
        this.logger.debug(`Cleaned up ${expiredKeys.length} expired cache entries`);
      }

      // Adaptive cache sizing based on current load
      await this.adaptiveCacheSizing();
    } catch (error) {
      this.logger.error('Error during cache cleanup:', error);
    }
  }

  /**
   * Starts the periodic metrics collection routine.
   * Collects and logs cache performance metrics every minute for monitoring.
   */
  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 60000); // Every minute
  }

  /**
   * Updates and logs cache performance metrics.
   * Monitors hit rates and memory usage, logging warnings when thresholds are exceeded.
   */
  private updateMetrics() {
    // Log cache performance warnings
    if (this.metrics.hitRate < 50) {
      this.logger.warn(`Low cache hit rate: ${this.metrics.hitRate.toFixed(1)}%`);
    }

    if (this.metrics.memoryUsage > 100 * 1024 * 1024) {
      // 100MB
      this.logger.warn(`High cache memory usage: ${(this.metrics.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  /**
   * Cleanup method called when the module is being destroyed.
   * Clears all intervals to prevent memory leaks and resource cleanup.
   */
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
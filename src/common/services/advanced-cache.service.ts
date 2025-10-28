import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { PerformanceOptimizationService } from './performance-optimization.service';

export interface CacheStrategy {
  name: string;
  ttl: number;
  maxSize?: number;
  evictionPolicy: 'lru' | 'lfu' | 'ttl' | 'adaptive';
  compression?: boolean;
  serialization?: 'json' | 'msgpack' | 'none';
}

export interface CacheEntry {
  key: string;
  value: any;
  metadata: {
    hits: number;
    lastAccessed: number;
    createdAt: number;
    ttl: number;
    size: number;
    strategy: string;
  };
}

export interface CacheMetrics {
  totalRequests: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  memoryUsage: number;
  averageResponseTime: number;
}

@Injectable()
export class AdvancedCacheService implements OnModuleInit {
  private readonly logger = new Logger(AdvancedCacheService.name);
  private strategies: Map<string, CacheStrategy> = new Map();
  private cacheEntries: Map<string, CacheEntry> = new Map();
  private metrics: CacheMetrics = {
    totalRequests: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    evictions: 0,
    memoryUsage: 0,
    averageResponseTime: 0,
  };

  private cleanupInterval: NodeJS.Timeout;
  private metricsInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    private basicCacheService: CacheService,
    private performanceService: PerformanceOptimizationService,
  ) {}

  async onModuleInit() {
    this.initializeStrategies();
    this.startCleanupRoutine();
    this.startMetricsCollection();
    this.logger.log('Advanced cache service initialized');
  }

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

    // Low-latency strategy for critical data
    this.registerStrategy({
      name: 'low-latency',
      ttl: 60, // 1 minute
      maxSize: 5000,
      evictionPolicy: 'lfu',
      compression: false,
      serialization: 'none',
    });

    // Long-term strategy for stable data
    this.registerStrategy({
      name: 'long-term',
      ttl: 3600, // 1 hour
      maxSize: 50000,
      evictionPolicy: 'ttl',
      compression: true,
      serialization: 'msgpack',
    });

    // Adaptive strategy that adjusts based on load
    this.registerStrategy({
      name: 'adaptive',
      ttl: 180, // 3 minutes
      maxSize: 20000,
      evictionPolicy: 'adaptive',
      compression: true,
      serialization: 'json',
    });
  }

  registerStrategy(strategy: CacheStrategy) {
    this.strategies.set(strategy.name, strategy);
    this.logger.log(`Cache strategy registered: ${strategy.name}`);
  }

  /**
   * Get value from cache with advanced strategies
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
   * Set value in cache with advanced strategies
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
   * Delete from cache
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
   * Clear cache for specific strategy or all
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
   * Get cache statistics
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
   * Warm up cache with frequently accessed data
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
   * Adaptive cache sizing based on load
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

  private getStrategyKey(key: string, strategyName: string): string {
    return `${strategyName}:${key}`;
  }

  private async evictEntries(strategyName: string) {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return;

    const strategyEntries = Array.from(this.cacheEntries.entries()).filter(
      ([, entry]) => entry.metadata.strategy === strategyName
    );

    if (strategyEntries.length === 0) return;

    let entriesToEvict: string[] = [];

    switch (strategy.evictionPolicy) {
      case 'lru':
        // Evict least recently used
        entriesToEvict = strategyEntries
          .sort(([, a], [, b]) => a.metadata.lastAccessed - b.metadata.lastAccessed)
          .slice(0, Math.floor(strategyEntries.length * 0.1))
          .map(([key]) => key);
        break;

      case 'lfu':
        // Evict least frequently used
        entriesToEvict = strategyEntries
          .sort(([, a], [, b]) => a.metadata.hits - b.metadata.hits)
          .slice(0, Math.floor(strategyEntries.length * 0.1))
          .map(([key]) => key);
        break;

      case 'ttl':
        // Evict expired entries
        const now = Date.now();
        entriesToEvict = strategyEntries
          .filter(([, entry]) => now - entry.metadata.createdAt >= entry.metadata.ttl * 1000)
          .map(([key]) => key);
        break;

      case 'adaptive':
        // Adaptive eviction based on multiple factors
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

  private calculateSize(value: any): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  private calculateTotalMemoryUsage(): number {
    let totalSize = 0;
    for (const entry of this.cacheEntries.values()) {
      totalSize += entry.metadata.size;
    }
    return totalSize;
  }

  private async compress(value: any): Promise<any> {
    // Simple compression - in real implementation, use proper compression library
    // For now, just return the value as-is
    return value;
  }

  private updateHitRate() {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;
  }

  private startCleanupRoutine() {
    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup();
    }, 300000); // Every 5 minutes
  }

  private async performCleanup() {
    try {
      // Clean expired entries
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

      // Adaptive cache sizing
      await this.adaptiveCacheSizing();
    } catch (error) {
      this.logger.error('Error during cache cleanup:', error);
    }
  }

  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 60000); // Every minute
  }

  private updateMetrics() {
    // Log cache performance
    if (this.metrics.hitRate < 50) {
      this.logger.warn(`Low cache hit rate: ${this.metrics.hitRate.toFixed(1)}%`);
    }

    if (this.metrics.memoryUsage > 100 * 1024 * 1024) { // 100MB
      this.logger.warn(`High cache memory usage: ${(this.metrics.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
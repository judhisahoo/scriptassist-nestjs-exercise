import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuration options for the cache service, defining TTL, size limits,
 * and namespace settings for cache management.
 */
export interface CacheConfig {
  /** Time-to-live in seconds for cached entries */
  ttl: number;
  /** Maximum number of entries allowed in the cache */
  maxSize?: number;
  /** Namespace prefix for cache keys to avoid collisions */
  namespace?: string;
}

/**
 * Statistics and metrics for cache performance monitoring,
 * tracking hits, misses, and operational counts.
 */
export interface CacheStats {
  /** Number of successful cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of cache set operations */
  sets: number;
  /** Number of cache delete operations */
  deletes: number;
  /** Number of cache clear operations */
  clears: number;
  /** Cache hit rate as a decimal (0.0 to 1.0) */
  hitRate: number;
}

/**
 * In-memory cache service with TTL support, LRU eviction, and comprehensive statistics.
 * Provides thread-safe caching with automatic cleanup and performance monitoring.
 *
 * Features:
 * - Time-to-live (TTL) expiration for cache entries
 * - Least Recently Used (LRU) eviction when capacity is reached
 * - Namespace support to prevent key collisions
 * - Deep cloning to prevent reference mutations
 * - Automatic cleanup of expired entries
 * - Comprehensive performance statistics
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  /** Internal cache storage using Map for O(1) access */
  private cache: Map<string, { value: any; expiresAt: number; lastAccessed: number }> = new Map();

  /** Cache performance statistics */
  private stats: CacheStats = { hits: 0, misses: 0, sets: 0, deletes: 0, clears: 0, hitRate: 0 };

  /** Maximum number of cache entries */
  private readonly maxSize: number;

  /** Default TTL in seconds for cache entries */
  private readonly defaultTtl: number;

  /** Namespace prefix for cache keys */
  private readonly namespace: string;

  /** Interval for periodic cleanup of expired entries */
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    @Optional() @Inject('CACHE_CONFIG') private cacheConfig?: CacheConfig,
  ) {
    this.maxSize = cacheConfig?.maxSize || this.configService.get('cache.maxSize', 1000);
    this.defaultTtl = cacheConfig?.ttl || this.configService.get('cache.ttl', 300);
    this.namespace = cacheConfig?.namespace || this.configService.get('cache.namespace', 'app');

    // Start cleanup interval for expired items
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Clean every minute
  }

  /**
   * Cleanup method called when the module is being destroyed.
   * Clears the cleanup interval to prevent memory leaks.
   */
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Stores a value in the cache with optional TTL override.
   * Performs LRU eviction if cache is at capacity and deep clones the value
   * to prevent external mutations.
   *
   * @param key - The cache key to store the value under
   * @param value - The value to cache (will be deep cloned)
   * @param ttlSeconds - Optional TTL in seconds (uses default if not provided)
   * @returns Promise that resolves when the value is successfully cached
   * @throws Error if caching operation fails
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const ttl = ttlSeconds || this.defaultTtl;
      const namespacedKey = this.getNamespacedKey(key);
      const expiresAt = Date.now() + ttl * 1000;

      // Check size limit and evict if necessary (LRU)
      if (this.cache.size >= this.maxSize) {
        this.evictLRU();
      }

      // Deep clone to prevent reference issues
      const clonedValue = this.deepClone(value);

      this.cache.set(namespacedKey, {
        value: clonedValue,
        expiresAt,
        lastAccessed: Date.now(),
      });

      this.stats.sets++;
      this.updateHitRate();

      this.logger.debug(`Cache set: ${namespacedKey}, TTL: ${ttl}s`);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a value from the cache by key.
   * Returns null if key doesn't exist or has expired.
   * Updates access statistics and last accessed time on hits.
   *
   * @param key - The cache key to retrieve
   * @returns The cached value or null if not found/expired
   * @template T - The expected return type for type safety
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const item = this.cache.get(namespacedKey);

      if (!item) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      // Check expiration
      if (item.expiresAt < Date.now()) {
        this.cache.delete(namespacedKey);
        this.stats.misses++;
        this.updateHitRate();
        this.logger.debug(`Cache miss (expired): ${namespacedKey}`);
        return null;
      }

      // Update last accessed time
      item.lastAccessed = Date.now();
      this.stats.hits++;
      this.updateHitRate();

      // Return deep clone to prevent mutations
      const clonedValue = this.deepClone(item.value);
      this.logger.debug(`Cache hit: ${namespacedKey}`);
      return clonedValue as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Removes a cached value by key.
   * Updates deletion statistics if the key existed.
   *
   * @param key - The cache key to delete
   * @returns True if the key existed and was deleted, false otherwise
   * @throws Error if deletion operation fails
   */
  async delete(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const existed = this.cache.delete(namespacedKey);

      if (existed) {
        this.stats.deletes++;
        this.logger.debug(`Cache delete: ${namespacedKey}`);
      }

      return existed;
    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clears all cached entries and resets the cache.
   * Updates clear statistics and logs the operation.
   *
   * @returns Promise that resolves when all entries are cleared
   * @throws Error if clear operation fails
   */
  async clear(): Promise<void> {
    try {
      this.cache.clear();
      this.stats.clears++;
      this.logger.debug('Cache cleared');
    } catch (error) {
      this.logger.error('Cache clear error:', error);
      throw error;
    }
  }

  /**
   * Checks if a key exists in the cache and hasn't expired.
   * Automatically removes expired entries.
   *
   * @param key - The cache key to check
   * @returns True if the key exists and is valid, false otherwise
   * @throws Error if check operation fails
   */
  async has(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const item = this.cache.get(namespacedKey);

      if (!item) {
        return false;
      }

      if (item.expiresAt < Date.now()) {
        this.cache.delete(namespacedKey);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Cache has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Returns a copy of current cache statistics.
   * Statistics include hits, misses, sets, deletes, clears, and hit rate.
   *
   * @returns Current cache performance statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Returns the current number of entries in the cache.
   * This includes both valid and potentially expired entries.
   *
   * @returns Number of cache entries
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * Generates a namespaced key to prevent cache key collisions
   * between different applications or services.
   *
   * @param key - The original cache key
   * @returns Namespaced key in format "namespace:key"
   */
  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /**
   * Evicts the least recently used (LRU) cache entry when capacity is reached.
   * Finds the entry with the oldest lastAccessed timestamp and removes it.
   */
  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestTime = Date.now();

    for (const [key, item] of this.cache) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`Evicted LRU item: ${oldestKey}`);
    }
  }

  /**
   * Performs periodic cleanup of expired cache entries.
   * Called automatically every minute to maintain cache health.
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache) {
      if (item.expiresAt < now) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.cache.delete(key));

    if (expiredKeys.length > 0) {
      this.logger.debug(`Cleaned up ${expiredKeys.length} expired cache items`);
    }
  }

  /**
   * Updates the cache hit rate based on current hit and miss statistics.
   * Hit rate is calculated as hits / (hits + misses).
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Creates a deep clone of an object to prevent external mutations
   * of cached values. Handles primitives, objects, arrays, and dates.
   *
   * @param obj - The object to deep clone
   * @returns A deep cloned copy of the object
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }

    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }
}

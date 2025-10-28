import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CacheConfig {
  ttl: number;
  maxSize?: number;
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  clears: number;
  hitRate: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private cache: Map<string, { value: any; expiresAt: number; lastAccessed: number }> = new Map();
  private stats: CacheStats = { hits: 0, misses: 0, sets: 0, deletes: 0, clears: 0, hitRate: 0 };
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private readonly namespace: string;
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

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

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

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getSize(): number {
    return this.cache.size;
  }

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

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

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

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

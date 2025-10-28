import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface DistributedCacheConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl: number;
  maxSize?: number;
}

@Injectable()
export class DistributedCacheService {
  private readonly logger = new Logger(DistributedCacheService.name);
  private redisClient: Redis;
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private readonly maxSize: number;
  private isConnected = false;

  constructor(
    private configService: ConfigService,
    @Optional() @Inject('DISTRIBUTED_CACHE_CONFIG') private cacheConfig?: DistributedCacheConfig,
  ) {
    this.keyPrefix = cacheConfig?.keyPrefix || this.configService.get('redis.keyPrefix', 'app:');
    this.defaultTtl = cacheConfig?.ttl || this.configService.get('redis.ttl', 300);
    this.maxSize = cacheConfig?.maxSize || this.configService.get('redis.maxSize', 10000);

    this.initializeRedis();
  }

  private initializeRedis() {
    try {
      const redisConfig = {
        host: this.cacheConfig?.host || this.configService.get('redis.host', 'localhost'),
        port: this.cacheConfig?.port || this.configService.get('redis.port', 6379),
        password: this.cacheConfig?.password || this.configService.get('redis.password'),
        db: this.cacheConfig?.db || this.configService.get('redis.db', 0),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      this.redisClient = new Redis(redisConfig);

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

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }

  private getNamespacedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, falling back to in-memory cache');
      // Could implement fallback to in-memory cache here
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

  async clear(): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, cannot clear');
      return;
    }

    try {
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

  async setMultiple(entries: Array<{ key: string; value: any; ttlSeconds?: number }>): Promise<void> {
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

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

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
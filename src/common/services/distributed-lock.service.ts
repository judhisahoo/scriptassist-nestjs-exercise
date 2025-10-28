import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface LockOptions {
  ttl: number; // Time to live in milliseconds
  retryCount: number;
  retryDelay: number;
  driftFactor: number; // Clock drift factor for Redlock
}

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private redisClient: Redis;
  private readonly lockPrefix = 'lock:';
  private readonly defaultOptions: LockOptions = {
    ttl: 30000, // 30 seconds
    retryCount: 3,
    retryDelay: 100,
    driftFactor: 0.01,
  };

  constructor(
    private configService: ConfigService,
    @Optional() @Inject('REDIS_CLIENT') private injectedRedisClient?: Redis,
  ) {
    // Use injected client or create new one
    if (this.injectedRedisClient) {
      this.redisClient = this.injectedRedisClient;
    } else {
      this.initializeRedis();
    }
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
        this.logger.log('Distributed lock service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Distributed lock service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for distributed locks:', error);
    }
  }

  async onModuleDestroy() {
    if (this.redisClient && !this.injectedRedisClient) {
      await this.redisClient.quit();
    }
  }

  /**
   * Acquire a distributed lock using Redis SET NX PX
   */
  async acquireLock(
    resource: string,
    ownerId: string,
    options?: Partial<LockOptions>,
  ): Promise<string | null> {
    const opts = { ...this.defaultOptions, ...options };
    const lockKey = this.getLockKey(resource);
    const lockValue = `${ownerId}:${Date.now()}`;

    for (let attempt = 0; attempt <= opts.retryCount; attempt++) {
      try {
        const result = await this.redisClient.set(
          lockKey,
          lockValue,
          'PX',
          opts.ttl,
          'NX',
        );

        if (result === 'OK') {
          this.logger.debug(`Lock acquired: ${lockKey} by ${ownerId}`);
          return lockValue;
        }

        if (attempt < opts.retryCount) {
          await this.delay(opts.retryDelay * (attempt + 1));
        }
      } catch (error) {
        this.logger.error(`Error acquiring lock ${lockKey}:`, error);
        if (attempt < opts.retryCount) {
          await this.delay(opts.retryDelay * (attempt + 1));
        }
      }
    }

    this.logger.warn(`Failed to acquire lock: ${lockKey} after ${opts.retryCount + 1} attempts`);
    return null;
  }

  /**
   * Release a distributed lock
   */
  async releaseLock(resource: string, lockValue: string): Promise<boolean> {
    const lockKey = this.getLockKey(resource);

    try {
      // Use Lua script to ensure atomic check-and-delete
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
   * Execute a function with automatic lock acquisition and release
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
      const result = await operation();
      return result;
    } finally {
      await this.releaseLock(resource, lockValue);
    }
  }

  /**
   * Check if a resource is currently locked
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
   * Get lock information
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
   * Force release a lock (use with caution)
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
   * Extend lock TTL
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

      const result = await this.redisClient.eval(script, 1, lockKey, lockValue, additionalTtl.toString());

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

  private getLockKey(resource: string): string {
    return `${this.lockPrefix}${resource}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
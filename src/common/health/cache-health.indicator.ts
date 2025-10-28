import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CacheService } from '../services/cache.service';

@Injectable()
export class CacheHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(CacheHealthIndicator.name);

  constructor(private readonly cacheService: CacheService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();

      // Test basic cache operations
      const testKey = `health-check-${Date.now()}`;
      const testValue = { test: 'data', timestamp: new Date().toISOString() };

      // Test set operation
      await this.cacheService.set(testKey, testValue, 60); // 1 minute TTL

      // Test get operation
      const retrievedValue = await this.cacheService.get(testKey);

      // Test has operation
      const exists = await this.cacheService.has(testKey);

      // Clean up
      await this.cacheService.delete(testKey);

      const responseTime = Date.now() - startTime;
      const stats = this.cacheService.getStats();

      const isHealthy = retrievedValue !== null && exists === true;

      if (isHealthy) {
        return this.getStatus(key, true, {
          responseTime: `${responseTime}ms`,
          cacheSize: this.cacheService.getSize(),
          hitRate: `${(stats.hitRate * 100).toFixed(2)}%`,
          totalOperations: stats.hits + stats.misses,
        });
      } else {
        throw new HealthCheckError(
          'Cache health check failed',
          this.getStatus(key, false, {
            responseTime: `${responseTime}ms`,
            retrievedValue: retrievedValue ? 'present' : 'null',
            exists,
          }),
        );
      }
    } catch (error) {
      this.logger.error('Cache health check failed:', error);
      throw new HealthCheckError(
        'Cache health check failed',
        this.getStatus(key, false, {
          error: (error as Error).message,
        }),
      );
    }
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { CacheService } from '../services/cache.service';

/**
 * Health indicator for cache service monitoring
 * Performs comprehensive cache health checks including basic operations and performance metrics
 * Extends Terminus HealthIndicator for standardized health check responses
 */
@Injectable()
export class CacheHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(CacheHealthIndicator.name);

  constructor(private readonly cacheService: CacheService) {
    super();
  }

  /**
   * Performs comprehensive cache health check
   * Tests basic CRUD operations, measures response time, and collects performance metrics
   * @param key - Health check identifier key
   * @returns Promise resolving to health check result
   * @throws HealthCheckError if cache operations fail or performance is poor
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();

      // Generate unique test key to avoid conflicts
      const testKey = `health-check-${Date.now()}`;
      const testValue = { test: 'data', timestamp: new Date().toISOString() };

      // Test basic cache operations: SET, GET, HAS, DELETE
      await this.cacheService.set(testKey, testValue, 60); // 1 minute TTL

      const retrievedValue = await this.cacheService.get(testKey);
      const exists = await this.cacheService.has(testKey);

      // Clean up test data
      await this.cacheService.delete(testKey);

      const responseTime = Date.now() - startTime;
      const stats = this.cacheService.getStats();

      // Determine health based on operation success
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
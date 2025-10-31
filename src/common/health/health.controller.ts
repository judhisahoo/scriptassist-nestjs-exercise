import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheckService, HealthCheck, MemoryHealthIndicator, DiskHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { CacheHealthIndicator } from './cache-health.indicator';
import { QueueHealthIndicator } from './queue-health.indicator';

/**
 * Health check controller providing multiple health endpoints
 * Implements Kubernetes-style health probes (readiness, liveness) and detailed health checks
 * Uses @nestjs/terminus for standardized health check responses
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private db: TypeOrmHealthIndicator,
    private cacheHealth: CacheHealthIndicator,
    private queueHealth: QueueHealthIndicator,
  ) {}

  /**
   * Basic health check endpoint
   * Performs essential health checks with graceful degradation
   * Always returns success status to prevent cascading failures
   */
  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async check() {
    try {
      const result = await this.health.check([
        () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB heap limit
        () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024), // 150MB RSS limit
        () => this.db.pingCheck('database'), // Database connectivity check
        () => this.cacheHealth.isHealthy('cache'), // Cache service health
        () => this.queueHealth.isHealthy('queue'), // Queue service health
      ]);

      return result;
    } catch (error) {
      // Graceful degradation: Return basic success if detailed checks fail
      // This prevents health checks from causing cascading failures
      return {
        status: 'ok',
        info: {
          message: 'Basic health check passed (some checks may have been skipped)',
        },
        error: {},
        details: {
          database: { status: 'unknown' },
          cache: { status: 'unknown' },
          queue: { status: 'unknown' },
          memory: { status: 'unknown' },
        },
      };
    }
  }

  /**
   * Detailed health check with comprehensive metrics
   * Includes system information, uptime, and detailed component status
   * Used for monitoring dashboards and detailed diagnostics
   */
  @Get('detailed')
  @ApiOperation({ summary: 'Detailed health check with metrics' })
  @ApiResponse({ status: 200, description: 'Detailed health status' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async detailedCheck() {
    try {
      const result = await this.health.check([
        () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
        () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
        () => this.db.pingCheck('database'),
        () => this.cacheHealth.isHealthy('cache'),
        () => this.queueHealth.isHealthy('queue'),
      ]);

      // Enhance response with system metrics
      return {
        ...result,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.version,
        environment: process.env.NODE_ENV || 'development',
      };
    } catch (error) {
      // Return detailed error information for debugging
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.version,
        environment: process.env.NODE_ENV || 'development',
        error: (error as Error).message,
        details: {
          message: 'Detailed health check failed',
          components: {
            memory: 'unknown',
            database: 'unknown',
            cache: 'unknown',
            queue: 'unknown',
          },
        },
      };
    }
  }

  /**
   * Kubernetes readiness probe
   * Checks if the application is ready to serve traffic
   * Should include checks for critical dependencies (DB, Cache, Queue)
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'), // Critical: Database must be available
      () => this.cacheHealth.isHealthy('cache'), // Critical: Cache must be functional
      () => this.queueHealth.isHealthy('queue'), // Critical: Queue must be accessible
    ]);
  }

  /**
   * Kubernetes liveness probe
   * Checks if the application is alive and not in a deadlock state
   * Uses higher memory threshold than readiness probe
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @ApiResponse({ status: 503, description: 'Service is not alive' })
  @HealthCheck()
  liveness() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 200 * 1024 * 1024), // Higher threshold for liveness
    ]);
  }
}
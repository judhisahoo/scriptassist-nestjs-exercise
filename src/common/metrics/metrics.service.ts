import { Injectable } from '@nestjs/common';
import { register, collectDefaultMetrics, Gauge, Counter, Histogram, Summary } from 'prom-client';

/**
 * Comprehensive metrics service using Prometheus client
 * Provides application observability with HTTP, cache, queue, database, and business logic metrics
 * Follows Prometheus naming conventions and best practices
 */
@Injectable()
export class MetricsService {
  // HTTP request metrics
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpRequestsTotal: Counter<string>;

  // Connection tracking
  private readonly activeConnections: Gauge<string>;

  // Cache performance metrics
  private readonly cacheHits: Counter<string>;
  private readonly cacheMisses: Counter<string>;

  // Queue processing metrics
  private readonly queueJobsProcessed: Counter<string>;
  private readonly queueJobsFailed: Counter<string>;

  // Database performance metrics
  private readonly dbQueryDuration: Histogram<string>;

  // Business logic performance metrics
  private readonly businessLogicDuration: Summary<string>;

  constructor() {
    // Enable collection of default Node.js metrics (CPU, memory, event loop, etc.)
    collectDefaultMetrics();

    // HTTP request duration histogram with appropriate buckets for web requests
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10], // Covers typical web request durations
    });

    // HTTP request counter for throughput monitoring
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    // Active connection gauge for connection pool monitoring
    this.activeConnections = new Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
    });

    // Cache hit counter for cache performance monitoring
    this.cacheHits = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_name'],
    });

    // Cache miss counter for cache effectiveness measurement
    this.cacheMisses = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_name'],
    });

    // Queue job processing counter for background job monitoring
    this.queueJobsProcessed = new Counter({
      name: 'queue_jobs_processed_total',
      help: 'Total number of queue jobs processed',
      labelNames: ['queue_name', 'job_type'],
    });

    // Queue job failure counter for error rate monitoring
    this.queueJobsFailed = new Counter({
      name: 'queue_jobs_failed_total',
      help: 'Total number of queue jobs failed',
      labelNames: ['queue_name', 'job_type'],
    });

    // Database query duration histogram for performance monitoring
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5], // Appropriate for database query times
    });

    // Business logic duration summary with percentiles for SLA monitoring
    this.businessLogicDuration = new Summary({
      name: 'business_logic_duration_seconds',
      help: 'Duration of business logic operations',
      labelNames: ['operation', 'entity'],
      percentiles: [0.5, 0.9, 0.95, 0.99], // P50, P90, P95, P99 percentiles
    });
  }

  /**
   * Records HTTP request metrics
   * @param method - HTTP method (GET, POST, etc.)
   * @param route - Request route/path
   * @param statusCode - HTTP response status code
   * @param duration - Request duration in seconds
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    this.httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration);
    this.httpRequestsTotal.labels(method, route, statusCode.toString()).inc();
  }

  /**
   * Sets the current number of active connections
   * @param count - Number of active connections
   */
  setActiveConnections(count: number) {
    this.activeConnections.set(count);
  }

  /** Increments the active connections counter */
  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  /** Decrements the active connections counter */
  decrementActiveConnections() {
    this.activeConnections.dec();
  }

  /**
   * Records a cache hit
   * @param cacheName - Name of the cache instance (default: 'default')
   */
  recordCacheHit(cacheName: string = 'default') {
    this.cacheHits.labels(cacheName).inc();
  }

  /**
   * Records a cache miss
   * @param cacheName - Name of the cache instance (default: 'default')
   */
  recordCacheMiss(cacheName: string = 'default') {
    this.cacheMisses.labels(cacheName).inc();
  }

  /**
   * Records a successfully processed queue job
   * @param queueName - Name of the queue
   * @param jobType - Type/category of the job
   */
  recordQueueJobProcessed(queueName: string, jobType: string) {
    this.queueJobsProcessed.labels(queueName, jobType).inc();
  }

  /**
   * Records a failed queue job
   * @param queueName - Name of the queue
   * @param jobType - Type/category of the job
   */
  recordQueueJobFailed(queueName: string, jobType: string) {
    this.queueJobsFailed.labels(queueName, jobType).inc();
  }

  /**
   * Records database query execution time
   * @param operation - Database operation type (SELECT, INSERT, UPDATE, DELETE)
   * @param table - Database table name
   * @param duration - Query execution time in seconds
   */
  recordDbQuery(operation: string, table: string, duration: number) {
    this.dbQueryDuration.labels(operation, table).observe(duration);
  }

  /**
   * Records business logic operation duration
   * @param operation - Business operation name
   * @param entity - Entity/domain object name
   * @param duration - Operation duration in seconds
   */
  recordBusinessLogic(operation: string, entity: string, duration: number) {
    this.businessLogicDuration.labels(operation, entity).observe(duration);
  }

  /**
   * Returns all metrics in Prometheus text format
   * Used by the /metrics endpoint for Prometheus scraping
   * @returns Promise resolving to metrics string in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Returns the Prometheus registry for advanced use cases
   * Allows direct access to registry for custom metric operations
   * @returns Prometheus registry instance
   */
  getRegistry() {
    return register;
  }

  /**
   * Resets all custom metrics (preserves default Node.js metrics)
   * Useful for testing or metric cleanup scenarios
   */
  reset() {
    register.resetMetrics();
    collectDefaultMetrics(); // Re-enable default metrics collection
  }
}
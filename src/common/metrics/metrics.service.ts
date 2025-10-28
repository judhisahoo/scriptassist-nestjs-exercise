import { Injectable } from '@nestjs/common';
import { register, collectDefaultMetrics, Gauge, Counter, Histogram, Summary } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpRequestsTotal: Counter<string>;
  private readonly activeConnections: Gauge<string>;
  private readonly cacheHits: Counter<string>;
  private readonly cacheMisses: Counter<string>;
  private readonly queueJobsProcessed: Counter<string>;
  private readonly queueJobsFailed: Counter<string>;
  private readonly dbQueryDuration: Histogram<string>;
  private readonly businessLogicDuration: Summary<string>;

  constructor() {
    // Enable default metrics collection (CPU, memory, etc.)
    collectDefaultMetrics();

    // HTTP metrics
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    // Connection metrics
    this.activeConnections = new Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
    });

    // Cache metrics
    this.cacheHits = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_name'],
    });

    this.cacheMisses = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_name'],
    });

    // Queue metrics
    this.queueJobsProcessed = new Counter({
      name: 'queue_jobs_processed_total',
      help: 'Total number of queue jobs processed',
      labelNames: ['queue_name', 'job_type'],
    });

    this.queueJobsFailed = new Counter({
      name: 'queue_jobs_failed_total',
      help: 'Total number of queue jobs failed',
      labelNames: ['queue_name', 'job_type'],
    });

    // Database metrics
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    });

    // Business logic metrics
    this.businessLogicDuration = new Summary({
      name: 'business_logic_duration_seconds',
      help: 'Duration of business logic operations',
      labelNames: ['operation', 'entity'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
    });
  }

  // HTTP metrics methods
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    this.httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration);
    this.httpRequestsTotal.labels(method, route, statusCode.toString()).inc();
  }

  // Connection metrics methods
  setActiveConnections(count: number) {
    this.activeConnections.set(count);
  }

  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  decrementActiveConnections() {
    this.activeConnections.dec();
  }

  // Cache metrics methods
  recordCacheHit(cacheName: string = 'default') {
    this.cacheHits.labels(cacheName).inc();
  }

  recordCacheMiss(cacheName: string = 'default') {
    this.cacheMisses.labels(cacheName).inc();
  }

  // Queue metrics methods
  recordQueueJobProcessed(queueName: string, jobType: string) {
    this.queueJobsProcessed.labels(queueName, jobType).inc();
  }

  recordQueueJobFailed(queueName: string, jobType: string) {
    this.queueJobsFailed.labels(queueName, jobType).inc();
  }

  // Database metrics methods
  recordDbQuery(operation: string, table: string, duration: number) {
    this.dbQueryDuration.labels(operation, table).observe(duration);
  }

  // Business logic metrics methods
  recordBusinessLogic(operation: string, entity: string, duration: number) {
    this.businessLogicDuration.labels(operation, entity).observe(duration);
  }

  // Get metrics for Prometheus scraping
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Get registry for advanced use cases
  getRegistry() {
    return register;
  }

  // Reset all metrics (useful for testing)
  reset() {
    register.resetMetrics();
    collectDefaultMetrics();
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Comprehensive performance metrics collected for system monitoring and optimization.
 * Includes request statistics, resource usage, and system health indicators.
 */
export interface PerformanceMetrics {
  /** Total number of requests processed in the current interval */
  requestCount: number;
  /** Average response time in milliseconds */
  averageResponseTime: number;
  /** Current throughput in requests per second */
  throughput: number;
  /** Current error rate as a percentage (0-100) */
  errorRate: number;
  /** Current memory usage in megabytes */
  memoryUsage: number;
  /** Current CPU usage percentage */
  cpuUsage: number;
  /** Number of currently active connections */
  activeConnections: number;
  /** Current depth of the request queue */
  queueDepth: number;
}

/**
 * Configuration for backpressure management to prevent system overload.
 * Controls concurrent request limits, queuing, and timeout behavior.
 */
export interface BackpressureConfig {
  /** Maximum number of concurrent requests allowed */
  maxConcurrentRequests: number;
  /** Maximum size of the request queue */
  queueSize: number;
  /** Timeout in milliseconds for queued requests */
  timeout: number;
  /** Number of retry attempts for failed operations */
  retryAttempts: number;
}

/**
 * Configuration and status of a resource pool for connection and resource management.
 * Tracks pool sizing, availability, and wait queue statistics.
 */
export interface ResourcePool {
  /** Unique name identifier for the resource pool */
  name: string;
  /** Maximum number of resources allowed in the pool */
  maxSize: number;
  /** Minimum number of resources to maintain in the pool */
  minSize: number;
  /** Current number of resources in the pool */
  currentSize: number;
  /** Number of currently available resources */
  available: number;
  /** Number of requests waiting for resources */
  waitQueue: number;
}

/**
 * Service for performance optimization and backpressure management.
 * Provides adaptive resource management, request queuing, and performance monitoring.
 *
 * @remarks
 * This service provides:
 * - Backpressure control to prevent system overload
 * - Adaptive resource pool management
 * - Performance metrics collection and monitoring
 * - Request queuing and prioritization
 * - Automatic scaling based on load patterns
 */
@Injectable()
export class PerformanceOptimizationService {
  /** Logger instance for performance optimization operations */
  private readonly logger = new Logger(PerformanceOptimizationService.name);

  /** Current performance metrics being tracked */
  private metrics: PerformanceMetrics = {
    requestCount: 0,
    averageResponseTime: 0,
    throughput: 0,
    errorRate: 0,
    memoryUsage: 0,
    cpuUsage: 0,
    activeConnections: 0,
    queueDepth: 0,
  };

  /** Configuration for backpressure management */
  private backpressureConfig: BackpressureConfig = {
    maxConcurrentRequests: 100,
    queueSize: 1000,
    timeout: 30000,
    retryAttempts: 3,
  };

  /** Map of resource pools for different types of connections */
  private resourcePools: Map<string, ResourcePool> = new Map();

  /** Number of currently active requests */
  private activeRequests = 0;

  /** Queue of pending requests when under backpressure */
  private requestQueue: Array<{
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  /** Interval for periodic metrics updates */
  private metricsInterval: NodeJS.Timeout;

  /** Timestamp of the last metrics update */
  private lastMetricsUpdate = Date.now();

  constructor(private configService: ConfigService) {
    this.initializeConfiguration();
    this.startMetricsCollection();
  }

  private initializeConfiguration() {
    this.backpressureConfig = {
      maxConcurrentRequests: this.configService.get('MAX_CONCURRENT_REQUESTS', 100),
      queueSize: this.configService.get('REQUEST_QUEUE_SIZE', 1000),
      timeout: this.configService.get('REQUEST_TIMEOUT', 30000),
      retryAttempts: this.configService.get('RETRY_ATTEMPTS', 3),
    };

    // Initialize resource pools
    this.initializeResourcePools();
  }

  private initializeResourcePools() {
    // Database connection pool
    this.createResourcePool('database', {
      maxSize: this.configService.get('DB_POOL_MAX', 20),
      minSize: this.configService.get('DB_POOL_MIN', 5),
    });

    // Cache connection pool
    this.createResourcePool('cache', {
      maxSize: this.configService.get('CACHE_POOL_MAX', 10),
      minSize: this.configService.get('CACHE_POOL_MIN', 2),
    });

    // External API connection pool
    this.createResourcePool('external-api', {
      maxSize: this.configService.get('API_POOL_MAX', 50),
      minSize: this.configService.get('API_POOL_MIN', 10),
    });
  }

  private createResourcePool(name: string, config: { maxSize: number; minSize: number }) {
    this.resourcePools.set(name, {
      name,
      maxSize: config.maxSize,
      minSize: config.minSize,
      currentSize: config.minSize,
      available: config.minSize,
      waitQueue: 0,
    });
  }

  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 5000); // Update every 5 seconds
  }

  private updateMetrics() {
    const now = Date.now();
    const timeDiff = (now - this.lastMetricsUpdate) / 1000; // seconds

    // Calculate throughput (requests per second)
    this.metrics.throughput = this.metrics.requestCount / Math.max(timeDiff, 1);

    // Update memory and CPU usage
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB

    // Reset counters for next interval
    this.metrics.requestCount = 0;
    this.lastMetricsUpdate = now;

    // Log performance warnings
    if (this.metrics.memoryUsage > 400) {
      this.logger.warn(`High memory usage: ${this.metrics.memoryUsage.toFixed(2)}MB`);
    }

    if (this.metrics.throughput > this.backpressureConfig.maxConcurrentRequests) {
      this.logger.warn(`High throughput detected: ${this.metrics.throughput.toFixed(2)} req/s`);
    }
  }

  /**
   * Executes an operation with backpressure control to prevent system overload.
   * Queues requests when concurrent limits are exceeded and processes them when capacity becomes available.
   *
   * @param operation - The async operation to execute
   * @param options - Configuration options for execution priority and timeouts
   * @returns The result of the operation
   * @throws Error if the operation fails or times out in queue
   */
  async executeWithBackpressure<T>(
    operation: () => Promise<T>,
    options: {
      /** Priority level for queue processing */
      priority?: 'high' | 'normal' | 'low';
      /** Custom timeout for the operation */
      timeout?: number;
      /** Number of retry attempts on failure */
      retries?: number;
    } = {},
  ): Promise<T> {
    const { priority = 'normal', timeout = this.backpressureConfig.timeout, retries = this.backpressureConfig.retryAttempts } = options;

    return new Promise((resolve, reject) => {
      const executeOperation = async () => {
        if (this.activeRequests >= this.backpressureConfig.maxConcurrentRequests) {
          // Queue the request
          if (this.requestQueue.length >= this.backpressureConfig.queueSize) {
            reject(new Error('Request queue full - backpressure applied'));
            return;
          }

          const timeoutHandle = setTimeout(() => {
            const index = this.requestQueue.findIndex(item => item.timeout === timeoutHandle);
            if (index > -1) {
              this.requestQueue.splice(index, 1);
              reject(new Error('Request timeout in queue'));
            }
          }, timeout);

          this.requestQueue.push({
            operation,
            resolve,
            reject,
            timeout: timeoutHandle,
          });

          this.logger.debug(`Request queued. Queue depth: ${this.requestQueue.length}`);
          return;
        }

        this.activeRequests++;
        this.metrics.requestCount++;

        try {
          let result: T;
          let lastError: Error;

          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              result = await operation();
              break;
            } catch (error) {
              lastError = error as Error;
              this.logger.warn(`Operation failed (attempt ${attempt}/${retries}): ${lastError.message}`);

              if (attempt < retries) {
                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await this.delay(delay);
              }
            }
          }

          if (!result!) {
            throw lastError!;
          }

          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      executeOperation();
    });
  }

  private processQueue() {
    if (this.requestQueue.length === 0 || this.activeRequests >= this.backpressureConfig.maxConcurrentRequests) {
      return;
    }

    // Process highest priority requests first
    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      clearTimeout(nextRequest.timeout);
      this.executeWithBackpressure(nextRequest.operation)
        .then(nextRequest.resolve)
        .catch(nextRequest.reject);
    }
  }

  /**
   * Acquires a resource from the specified pool with backpressure handling.
   * Automatically scales the pool if needed and waits for availability.
   *
   * @param poolName - Name of the resource pool to acquire from
   * @returns True if resource was acquired successfully
   */
  async acquireResource(poolName: string): Promise<boolean> {
    const pool = this.resourcePools.get(poolName);
    if (!pool) {
      throw new Error(`Resource pool ${poolName} not found`);
    }

    if (pool.available > 0) {
      pool.available--;
      return true;
    }

    // Pool exhausted, apply backpressure
    if (pool.currentSize < pool.maxSize) {
      // Scale up pool
      pool.currentSize++;
      pool.available++;
      pool.available--;
      this.logger.debug(`Scaled up ${poolName} pool to ${pool.currentSize}`);
      return true;
    }

    // Pool at max capacity
    pool.waitQueue++;
    this.logger.warn(`Resource pool ${poolName} exhausted. Wait queue: ${pool.waitQueue}`);

    // Wait for resource to become available
    return new Promise((resolve) => {
      const checkAvailability = () => {
        if (pool.available > 0) {
          pool.available--;
          pool.waitQueue--;
          resolve(true);
        } else {
          setTimeout(checkAvailability, 100);
        }
      };
      checkAvailability();
    });
  }

  /**
   * Releases a resource back to the specified pool.
   * Automatically scales down the pool if there are too many idle resources.
   *
   * @param poolName - Name of the resource pool to release to
   */
  releaseResource(poolName: string) {
    const pool = this.resourcePools.get(poolName);
    if (pool) {
      pool.available = Math.min(pool.available + 1, pool.currentSize);

      // Scale down if too many idle resources
      if (pool.available > pool.minSize && pool.currentSize > pool.minSize) {
        pool.currentSize--;
        pool.available--;
        this.logger.debug(`Scaled down ${poolName} pool to ${pool.currentSize}`);
      }
    }
  }

  /**
   * Retrieves the current performance metrics snapshot.
   * Provides real-time statistics about system performance and resource usage.
   *
   * @returns Current performance metrics object
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Retrieves the current status of all resource pools.
   * Provides detailed information about pool utilization and availability.
   *
   * @returns Object mapping pool names to their current status
   */
  getResourcePools(): Record<string, ResourcePool> {
    const result: Record<string, ResourcePool> = {};
    for (const [name, pool] of this.resourcePools) {
      result[name] = { ...pool };
    }
    return result;
  }

  /**
   * Retrieves the current backpressure status and queue information.
   * Useful for monitoring system load and queue depth.
   *
   * @returns Object containing backpressure metrics and status
   */
  getBackpressureStatus() {
    return {
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.backpressureConfig.maxConcurrentRequests,
      queueDepth: this.requestQueue.length,
      maxQueueSize: this.backpressureConfig.queueSize,
      isUnderPressure: this.activeRequests >= this.backpressureConfig.maxConcurrentRequests * 0.8,
    };
  }

  /**
   * Performs adaptive scaling of resource pools based on current load metrics.
   * Automatically increases or decreases pool sizes to optimize performance.
   */
  async adaptiveScaling() {
    const metrics = this.getMetrics();

    // Scale database pool based on throughput
    if (metrics.throughput > 50) {
      const dbPool = this.resourcePools.get('database');
      if (dbPool && dbPool.currentSize < dbPool.maxSize) {
        dbPool.currentSize = Math.min(dbPool.currentSize + 2, dbPool.maxSize);
        dbPool.available = Math.min(dbPool.available + 2, dbPool.currentSize);
        this.logger.log(`Auto-scaled database pool to ${dbPool.currentSize} connections`);
      }
    }

    // Scale down when load decreases
    if (metrics.throughput < 10) {
      const dbPool = this.resourcePools.get('database');
      if (dbPool && dbPool.currentSize > dbPool.minSize) {
        const scaleDown = Math.min(1, dbPool.currentSize - dbPool.minSize);
        dbPool.currentSize -= scaleDown;
        dbPool.available = Math.max(0, dbPool.available - scaleDown);
        this.logger.log(`Auto-scaled down database pool to ${dbPool.currentSize} connections`);
      }
    }
  }

  /**
   * Records operation timing data for performance monitoring and analysis.
   * Updates running averages and error rates using exponential moving averages.
   *
   * @param operation - Name or identifier of the operation
   * @param duration - Operation duration in milliseconds
   * @param success - Whether the operation completed successfully
   */
  recordOperationTiming(operation: string, duration: number, success: boolean) {
    // Update average response time (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    this.metrics.averageResponseTime = alpha * duration + (1 - alpha) * this.metrics.averageResponseTime;

    if (!success) {
      this.metrics.errorRate = alpha * 1 + (1 - alpha) * this.metrics.errorRate;
    } else {
      this.metrics.errorRate = (1 - alpha) * this.metrics.errorRate;
    }

    // Log slow operations
    if (duration > 5000) {
      this.logger.warn(`Slow operation detected: ${operation} took ${duration}ms`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Clear all queued requests
    this.requestQueue.forEach(request => {
      clearTimeout(request.timeout);
      request.reject(new Error('Service shutting down'));
    });
    this.requestQueue = [];
  }
}
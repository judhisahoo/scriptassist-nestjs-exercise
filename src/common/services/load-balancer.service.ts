import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

/**
 * Configuration options for the load balancer service.
 * Defines the load balancing algorithm and behavior parameters.
 */
export interface LoadBalancerConfig {
  /** Load balancing algorithm to use for instance selection */
  algorithm: 'round-robin' | 'least-connections' | 'weighted-round-robin' | 'adaptive';
  /** Interval in milliseconds between health checks */
  healthCheckInterval: number;
  /** Maximum number of retry attempts for failed requests */
  maxRetries: number;
  /** Timeout in milliseconds for failover operations */
  failoverTimeout: number;
}

/**
 * Represents a backend instance in the load balancer pool.
 * Contains health status, performance metrics, and load balancing information.
 */
export interface BackendInstance {
  /** Unique identifier for the instance */
  id: string;
  /** Base URL of the backend instance */
  url: string;
  /** Weight for weighted load balancing algorithms */
  weight: number;
  /** Whether the instance is currently healthy */
  healthy: boolean;
  /** Number of active connections to this instance */
  activeConnections: number;
  /** Total number of requests served by this instance */
  totalRequests: number;
  /** Number of failed requests for this instance */
  errorCount: number;
  /** Average response time in milliseconds */
  averageResponseTime: number;
  /** Timestamp of the last health check */
  lastHealthCheck: number;
  /** Number of consecutive health check failures */
  consecutiveFailures: number;
}

/**
 * Result of a load balancing operation.
 * Contains the selected instance and attempt information for failover tracking.
 */
export interface LoadBalancingResult {
  /** The selected backend instance for the request */
  instance: BackendInstance;
  /** Current attempt number (1-based) */
  attempt: number;
  /** Total number of attempts allowed */
  totalAttempts: number;
}

/**
 * Service for load balancing requests across multiple backend instances.
 * Supports various load balancing algorithms with health monitoring and automatic failover.
 *
 * @remarks
 * This service provides:
 * - Multiple load balancing algorithms (round-robin, least-connections, weighted, adaptive)
 * - Health monitoring and automatic instance failover
 * - Performance metrics collection and adaptive routing
 * - Dynamic instance management (add/remove/update weights)
 */
@Injectable()
export class LoadBalancerService implements OnModuleInit {
  /** Logger instance for load balancer operations */
  private readonly logger = new Logger(LoadBalancerService.name);

  /** Array of backend instances managed by the load balancer */
  private instances: BackendInstance[] = [];

  /** Current index for round-robin algorithm */
  private currentIndex = 0;

  /** Load balancer configuration settings */
  private config: LoadBalancerConfig;

  /** Interval for periodic health checks */
  private healthCheckInterval: NodeJS.Timeout;

  /**
   * Creates an instance of LoadBalancerService.
   *
   * @param configService - Service for accessing application configuration
   * @param performanceService - Service for performance monitoring and optimization
   */
  constructor(
    private configService: ConfigService,
    private performanceService: PerformanceOptimizationService,
  ) {
    this.config = {
      algorithm: this.configService.get('LOAD_BALANCER_ALGORITHM', 'adaptive'),
      healthCheckInterval: this.configService.get('HEALTH_CHECK_INTERVAL', 30000),
      maxRetries: this.configService.get('LOAD_BALANCER_MAX_RETRIES', 3),
      failoverTimeout: this.configService.get('FAILOVER_TIMEOUT', 5000),
    };
  }

  async onModuleInit() {
    this.initializeInstances();
    this.startHealthChecks();
    this.logger.log(`Load balancer initialized with ${this.instances.length} instances`);
  }

  private initializeInstances() {
    // Initialize with default instances - in real scenario, this would come from config or service discovery
    const instanceUrls = this.configService.get('BACKEND_INSTANCES', ['http://localhost:3000']);

    instanceUrls.forEach((url: string, index: number) => {
      this.instances.push({
        id: `instance-${index}`,
        url,
        weight: 1,
        healthy: true,
        activeConnections: 0,
        totalRequests: 0,
        errorCount: 0,
        averageResponseTime: 0,
        lastHealthCheck: Date.now(),
        consecutiveFailures: 0,
      });
    });
  }

  private startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Selects a backend instance using the configured load balancing algorithm.
   * Updates instance metrics and returns the selected instance with attempt information.
   *
   * @param requestWeight - Weight factor for the request (used by adaptive algorithm)
   * @returns Load balancing result containing selected instance and attempt info
   * @throws Error if no healthy instances are available
   */
  async selectInstance(requestWeight: number = 1): Promise<LoadBalancingResult> {
    const healthyInstances = this.instances.filter(instance => instance.healthy);

    if (healthyInstances.length === 0) {
      throw new Error('No healthy backend instances available');
    }

    let selectedInstance: BackendInstance;

    switch (this.config.algorithm) {
      case 'round-robin':
        selectedInstance = this.selectRoundRobin(healthyInstances);
        break;

      case 'least-connections':
        selectedInstance = this.selectLeastConnections(healthyInstances);
        break;

      case 'weighted-round-robin':
        selectedInstance = this.selectWeightedRoundRobin(healthyInstances);
        break;

      case 'adaptive':
      default:
        selectedInstance = this.selectAdaptive(healthyInstances, requestWeight);
        break;
    }

    // Update instance metrics
    selectedInstance.activeConnections++;
    selectedInstance.totalRequests++;

    return {
      instance: selectedInstance,
      attempt: 1,
      totalAttempts: 1,
    };
  }

  /**
   * Selects the next instance in round-robin fashion.
   * Cycles through healthy instances sequentially.
   *
   * @param healthyInstances - Array of healthy backend instances
   * @returns Selected backend instance
   */
  private selectRoundRobin(healthyInstances: BackendInstance[]): BackendInstance {
    const instance = healthyInstances[this.currentIndex % healthyInstances.length];
    this.currentIndex = (this.currentIndex + 1) % healthyInstances.length;
    return instance;
  }

  /**
   * Selects the instance with the fewest active connections.
   * Distributes load to the least busy instances.
   *
   * @param healthyInstances - Array of healthy backend instances
   * @returns Selected backend instance with least connections
   */
  private selectLeastConnections(healthyInstances: BackendInstance[]): BackendInstance {
    return healthyInstances.reduce((selected, current) =>
      current.activeConnections < selected.activeConnections ? current : selected
    );
  }

  /**
   * Selects instances based on their weights using weighted round-robin.
   * Instances with higher weights receive proportionally more requests.
   *
   * @param healthyInstances - Array of healthy backend instances
   * @returns Selected backend instance based on weight distribution
   */
  private selectWeightedRoundRobin(healthyInstances: BackendInstance[]): BackendInstance {
    // Calculate total weight
    const totalWeight = healthyInstances.reduce((sum, instance) => sum + instance.weight, 0);

    // Find instance based on current weight distribution
    let cumulativeWeight = 0;
    const targetWeight = (this.currentIndex % totalWeight) + 1;

    for (const instance of healthyInstances) {
      cumulativeWeight += instance.weight;
      if (cumulativeWeight >= targetWeight) {
        this.currentIndex = (this.currentIndex + 1) % totalWeight;
        return instance;
      }
    }

    // Fallback to first instance
    return healthyInstances[0];
  }

  /**
   * Selects instances adaptively based on multiple performance metrics.
   * Uses a scoring algorithm that considers connections, error rates, response times, and weights.
   *
   * @param healthyInstances - Array of healthy backend instances
   * @param requestWeight - Weight factor for the request (currently unused)
   * @returns Selected backend instance with highest performance score
   */
  private selectAdaptive(healthyInstances: BackendInstance[], requestWeight: number): BackendInstance {
    // Score instances based on multiple factors
    const scoredInstances = healthyInstances.map(instance => {
      const connectionScore = 1 / (instance.activeConnections + 1); // Lower connections = higher score
      const errorRate = instance.totalRequests > 0 ? instance.errorCount / instance.totalRequests : 0;
      const errorScore = 1 - errorRate; // Lower error rate = higher score
      const responseTimeScore = instance.averageResponseTime > 0 ? 1000 / instance.averageResponseTime : 1; // Lower response time = higher score
      const weightScore = instance.weight / 10; // Weight factor

      const totalScore = (connectionScore * 0.4) + (errorScore * 0.3) + (responseTimeScore * 0.2) + (weightScore * 0.1);

      return { instance, score: totalScore };
    });

    // Select instance with highest score
    scoredInstances.sort((a, b) => b.score - a.score);
    return scoredInstances[0].instance;
  }

  /**
   * Records the completion of a request and updates instance performance metrics.
   * Updates connection counts, error rates, and response time averages.
   *
   * @param instanceId - ID of the backend instance that handled the request
   * @param responseTime - Response time in milliseconds
   * @param success - Whether the request was successful
   */
  recordRequestCompletion(instanceId: string, responseTime: number, success: boolean) {
    const instance = this.instances.find(inst => inst.id === instanceId);
    if (!instance) return;

    instance.activeConnections = Math.max(0, instance.activeConnections - 1);

    if (!success) {
      instance.errorCount++;
      instance.consecutiveFailures++;
    } else {
      instance.consecutiveFailures = 0;

      // Update average response time (exponential moving average)
      const alpha = 0.1;
      instance.averageResponseTime = alpha * responseTime + (1 - alpha) * instance.averageResponseTime;
    }
  }

  /**
   * Performs health checks on all backend instances concurrently.
   * Updates instance health status and metrics based on check results.
   */
  private async performHealthChecks() {
    const healthCheckPromises = this.instances.map(async (instance) => {
      try {
        const startTime = Date.now();

        // Perform health check (simplified - would make actual HTTP call)
        const isHealthy = await this.checkInstanceHealth(instance);

        const responseTime = Date.now() - startTime;
        instance.lastHealthCheck = Date.now();

        if (isHealthy) {
          if (!instance.healthy) {
            this.logger.log(`Instance ${instance.id} recovered`);
          }
          instance.healthy = true;
          instance.consecutiveFailures = 0;

          // Update response time for healthy instances
          const alpha = 0.1;
          instance.averageResponseTime = alpha * responseTime + (1 - alpha) * instance.averageResponseTime;
        } else {
          instance.consecutiveFailures++;
          instance.errorCount++;

          if (instance.consecutiveFailures >= 3) {
            if (instance.healthy) {
              this.logger.warn(`Instance ${instance.id} marked as unhealthy`);
            }
            instance.healthy = false;
          }
        }
      } catch (error) {
        this.logger.error(`Health check failed for instance ${instance.id}:`, error);
        instance.consecutiveFailures++;
        instance.errorCount++;

        if (instance.consecutiveFailures >= 3) {
          instance.healthy = false;
        }
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Checks the health of a specific backend instance.
   * Uses error rates and failure patterns to determine health status.
   *
   * @param instance - The backend instance to check
   * @returns True if the instance is healthy, false otherwise
   */
  private async checkInstanceHealth(instance: BackendInstance): Promise<boolean> {
    try {
      // Simplified health check - in real implementation, make HTTP call to health endpoint
      // For now, simulate based on error patterns
      const errorRate = instance.totalRequests > 0 ? instance.errorCount / instance.totalRequests : 0;
      const isHealthy = errorRate < 0.1 && instance.consecutiveFailures < 3;

      // Add some randomness to simulate real-world conditions
      if (Math.random() < 0.05) { // 5% chance of random failure
        return false;
      }

      return isHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Executes an operation with automatic retry and failover across backend instances.
   * Handles timeouts, retries, and automatic instance selection with load balancing.
   *
   * @param operation - The operation to execute on a backend instance
   * @param requestWeight - Weight factor for load balancing algorithms
   * @returns The result of the successful operation
   * @throws Error if all retry attempts fail
   */
  async executeWithFailover<T>(
    operation: (instance: BackendInstance) => Promise<T>,
    requestWeight: number = 1,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.selectInstance(requestWeight);
        const instance = result.instance;

        // Execute operation with timeout
        const operationPromise = operation(instance);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), this.config.failoverTimeout);
        });

        const response = await Promise.race([operationPromise, timeoutPromise]);

        // Record successful completion
        this.recordRequestCompletion(instance.id, Date.now() - Date.now(), true);

        return response;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Request attempt ${attempt} failed:`, error);

        // Record failure for current instance if available
        if (attempt === 1) {
          // On first attempt, we don't have an instance to record against
          // This would be handled by the operation function
        }
      }
    }

    throw lastError!;
  }

  /**
   * Retrieves comprehensive statistics about the load balancer state.
   * Includes instance counts, request metrics, and error rates.
   *
   * @returns Object containing load balancer statistics and instance details
   */
  getStatistics() {
    const healthyInstances = this.instances.filter(inst => inst.healthy);
    const totalRequests = this.instances.reduce((sum, inst) => sum + inst.totalRequests, 0);
    const totalErrors = this.instances.reduce((sum, inst) => sum + inst.errorCount, 0);

    return {
      algorithm: this.config.algorithm,
      totalInstances: this.instances.length,
      healthyInstances: healthyInstances.length,
      unhealthyInstances: this.instances.length - healthyInstances.length,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      instances: this.instances.map(instance => ({
        id: instance.id,
        url: instance.url,
        healthy: instance.healthy,
        activeConnections: instance.activeConnections,
        totalRequests: instance.totalRequests,
        errorCount: instance.errorCount,
        averageResponseTime: Math.round(instance.averageResponseTime),
        weight: instance.weight,
      })),
    };
  }

  /**
   * Adds a new backend instance to the load balancer pool.
   * The instance starts as healthy and ready to receive traffic.
   *
   * @param url - Base URL of the backend instance
   * @param weight - Load balancing weight for the instance
   */
  addInstance(url: string, weight: number = 1) {
    const newInstance: BackendInstance = {
      id: `instance-${this.instances.length}`,
      url,
      weight,
      healthy: true,
      activeConnections: 0,
      totalRequests: 0,
      errorCount: 0,
      averageResponseTime: 0,
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
    };

    this.instances.push(newInstance);
    this.logger.log(`Added new backend instance: ${url}`);
  }

  /**
   * Removes a backend instance from the load balancer pool.
   * Existing connections to the instance may continue until completion.
   *
   * @param instanceId - ID of the instance to remove
   */
  removeInstance(instanceId: string) {
    const index = this.instances.findIndex(inst => inst.id === instanceId);
    if (index > -1) {
      const instance = this.instances[index];
      this.instances.splice(index, 1);
      this.logger.log(`Removed backend instance: ${instance.url}`);
    }
  }

  /**
   * Updates the load balancing weight for a specific instance.
   * Affects weighted round-robin and adaptive algorithms.
   *
   * @param instanceId - ID of the instance to update
   * @param weight - New weight value (must be >= 0)
   */
  updateInstanceWeight(instanceId: string, weight: number) {
    const instance = this.instances.find(inst => inst.id === instanceId);
    if (instance) {
      instance.weight = Math.max(0, weight);
      this.logger.log(`Updated weight for instance ${instanceId} to ${weight}`);
    }
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}
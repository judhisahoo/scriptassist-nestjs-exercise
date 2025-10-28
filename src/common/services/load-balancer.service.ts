import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

export interface LoadBalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted-round-robin' | 'adaptive';
  healthCheckInterval: number;
  maxRetries: number;
  failoverTimeout: number;
}

export interface BackendInstance {
  id: string;
  url: string;
  weight: number;
  healthy: boolean;
  activeConnections: number;
  totalRequests: number;
  errorCount: number;
  averageResponseTime: number;
  lastHealthCheck: number;
  consecutiveFailures: number;
}

export interface LoadBalancingResult {
  instance: BackendInstance;
  attempt: number;
  totalAttempts: number;
}

@Injectable()
export class LoadBalancerService implements OnModuleInit {
  private readonly logger = new Logger(LoadBalancerService.name);
  private instances: BackendInstance[] = [];
  private currentIndex = 0;
  private config: LoadBalancerConfig;
  private healthCheckInterval: NodeJS.Timeout;

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
   * Select backend instance based on load balancing algorithm
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
   * Round-robin selection
   */
  private selectRoundRobin(healthyInstances: BackendInstance[]): BackendInstance {
    const instance = healthyInstances[this.currentIndex % healthyInstances.length];
    this.currentIndex = (this.currentIndex + 1) % healthyInstances.length;
    return instance;
  }

  /**
   * Least connections selection
   */
  private selectLeastConnections(healthyInstances: BackendInstance[]): BackendInstance {
    return healthyInstances.reduce((selected, current) =>
      current.activeConnections < selected.activeConnections ? current : selected
    );
  }

  /**
   * Weighted round-robin selection
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
   * Adaptive selection based on performance metrics
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
   * Record request completion and update metrics
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
   * Perform health checks on all instances
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
   * Check health of a specific instance
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
   * Handle request with automatic retry and failover
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
   * Get load balancer statistics
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
   * Add new backend instance
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
   * Remove backend instance
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
   * Update instance weight for weighted algorithms
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
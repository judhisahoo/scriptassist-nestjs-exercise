import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

/**
 * Configuration for a managed resource with capacity limits and allocation strategies.
 * Defines how resources are managed, scaled, and allocated within the system.
 */
export interface ResourceConfig {
  /** Unique name identifier for the resource */
  name: string;
  /** Type of resource being managed */
  type: 'connection' | 'memory' | 'cpu' | 'io';
  /** Maximum capacity allowed for this resource */
  maxCapacity: number;
  /** Minimum capacity to maintain for this resource */
  minCapacity: number;
  /** Current allocated capacity for this resource */
  currentCapacity: number;
  /** Strategy for allocating and scaling the resource */
  allocationStrategy: 'static' | 'dynamic' | 'adaptive';
  /** Priority level for resource allocation (higher = more important) */
  priority: number;
}

/**
 * Represents a resource allocation record tracking who requested what and when.
 * Used for monitoring resource usage and managing allocations.
 */
export interface ResourceAllocation {
  /** Name of the resource that was allocated */
  resourceName: string;
  /** Amount actually allocated */
  allocated: number;
  /** Amount originally requested */
  requested: number;
  /** Timestamp when the allocation was made */
  timestamp: number;
  /** Identifier of who made the allocation request */
  requester: string;
}

/**
 * Performance and utilization metrics for a managed resource.
 * Tracks how effectively the resource is being used and identifies bottlenecks.
 */
export interface ResourceMetrics {
  /** Current utilization percentage (0-100) */
  utilization: number;
  /** Efficiency rating based on resource type and usage patterns (0-1) */
  efficiency: number;
  /** Contention percentage indicating how often requests are blocked (0-100) */
  contention: number;
  /** Current throughput for this resource */
  throughput: number;
  /** Average latency for resource operations */
  latency: number;
}

/**
 * Service for managing system resources with dynamic allocation and scaling.
 * Provides resource pooling, monitoring, and automatic optimization for CPU, memory, connections, and I/O.
 *
 * @remarks
 * This service provides:
 * - Resource registration and configuration
 * - Dynamic resource allocation with backpressure
 * - Automatic scaling based on utilization patterns
 * - Resource monitoring and metrics collection
 * - Contention detection and optimization
 * - Forecasting for capacity planning
 */
@Injectable()
export class ResourceManagerService implements OnModuleInit, OnModuleDestroy {
  /** Logger instance for resource management operations */
  private readonly logger = new Logger(ResourceManagerService.name);

  /** Map of registered resources by name */
  private resources: Map<string, ResourceConfig> = new Map();

  /** Map of resource allocations by resource name */
  private allocations: Map<string, ResourceAllocation[]> = new Map();

  /** Map of resource performance metrics by resource name */
  private resourceMetrics: Map<string, ResourceMetrics> = new Map();

  /** Interval for periodic resource monitoring */
  private monitoringInterval: NodeJS.Timeout;

  constructor(
    private configService: ConfigService,
    private performanceService: PerformanceOptimizationService,
  ) {}

  async onModuleInit() {
    this.initializeResources();
    this.startResourceMonitoring();
    this.logger.log('Resource manager initialized');
  }

  async onModuleDestroy() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  private initializeResources() {
    // CPU Resource
    this.registerResource({
      name: 'cpu',
      type: 'cpu',
      maxCapacity: this.configService.get('CPU_MAX_CAPACITY', 100), // percentage
      minCapacity: this.configService.get('CPU_MIN_CAPACITY', 10),
      currentCapacity: 50,
      allocationStrategy: 'adaptive',
      priority: 10,
    });

    // Memory Resource
    this.registerResource({
      name: 'memory',
      type: 'memory',
      maxCapacity: this.configService.get('MEMORY_MAX_CAPACITY', 1024), // MB
      minCapacity: this.configService.get('MEMORY_MIN_CAPACITY', 256),
      currentCapacity: 512,
      allocationStrategy: 'dynamic',
      priority: 9,
    });

    // Database Connections
    this.registerResource({
      name: 'db-connections',
      type: 'connection',
      maxCapacity: this.configService.get('DB_MAX_CONNECTIONS', 50),
      minCapacity: this.configService.get('DB_MIN_CONNECTIONS', 10),
      currentCapacity: 20,
      allocationStrategy: 'adaptive',
      priority: 8,
    });

    // Cache Connections
    this.registerResource({
      name: 'cache-connections',
      type: 'connection',
      maxCapacity: this.configService.get('CACHE_MAX_CONNECTIONS', 20),
      minCapacity: this.configService.get('CACHE_MIN_CONNECTIONS', 5),
      currentCapacity: 10,
      allocationStrategy: 'dynamic',
      priority: 7,
    });

    // External API Connections
    this.registerResource({
      name: 'api-connections',
      type: 'connection',
      maxCapacity: this.configService.get('API_MAX_CONNECTIONS', 100),
      minCapacity: this.configService.get('API_MIN_CONNECTIONS', 20),
      currentCapacity: 50,
      allocationStrategy: 'adaptive',
      priority: 6,
    });

    // IO Operations
    this.registerResource({
      name: 'io-operations',
      type: 'io',
      maxCapacity: this.configService.get('IO_MAX_OPERATIONS', 1000), // ops per second
      minCapacity: this.configService.get('IO_MIN_OPERATIONS', 100),
      currentCapacity: 500,
      allocationStrategy: 'static',
      priority: 5,
    });
  }

  private startResourceMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      await this.monitorResources();
      await this.optimizeResourceAllocation();
    }, 10000); // Monitor every 10 seconds
  }

  registerResource(config: ResourceConfig) {
    this.resources.set(config.name, config);
    this.allocations.set(config.name, []);
    this.resourceMetrics.set(config.name, {
      utilization: 0,
      efficiency: 1,
      contention: 0,
      throughput: 0,
      latency: 0,
    });
    this.logger.log(`Resource registered: ${config.name} (${config.type})`);
  }

  /**
   * Requests allocation of a specified amount from a named resource pool.
   * Attempts to allocate immediately, or scales the resource if possible.
   *
   * @param resourceName - Name of the resource to allocate from
   * @param amount - Amount of resource to allocate
   * @param requester - Identifier of who is requesting the allocation
   * @returns True if allocation was successful, false otherwise
   */
  async requestAllocation(
    resourceName: string,
    amount: number,
    requester: string,
  ): Promise<boolean> {
    const resource = this.resources.get(resourceName);
    if (!resource) {
      throw new Error(`Resource ${resourceName} not found`);
    }

    const currentAllocations = this.getCurrentAllocations(resourceName);
    const availableCapacity = resource.currentCapacity - currentAllocations;

    if (availableCapacity >= amount) {
      // Allocate resource
      const allocation: ResourceAllocation = {
        resourceName,
        allocated: amount,
        requested: amount,
        timestamp: Date.now(),
        requester,
      };

      this.allocations.get(resourceName)!.push(allocation);
      this.logger.debug(`Allocated ${amount} of ${resourceName} to ${requester}`);
      return true;
    }

    // Try to scale up resource if possible
    if (await this.attemptResourceScaling(resourceName, amount)) {
      const allocation: ResourceAllocation = {
        resourceName,
        allocated: amount,
        requested: amount,
        timestamp: Date.now(),
        requester,
      };

      this.allocations.get(resourceName)!.push(allocation);
      this.logger.debug(`Allocated ${amount} of ${resourceName} to ${requester} (after scaling)`);
      return true;
    }

    this.logger.warn(`Resource allocation failed: ${resourceName} requested ${amount}, available ${availableCapacity}`);
    return false;
  }

  /**
   * Release resource allocation
   */
  releaseAllocation(resourceName: string, requester: string, amount?: number) {
    const resourceAllocations = this.allocations.get(resourceName);
    if (!resourceAllocations) return;

    const allocationIndex = resourceAllocations.findIndex(
      alloc => alloc.requester === requester && (!amount || alloc.allocated === amount)
    );

    if (allocationIndex > -1) {
      const allocation = resourceAllocations[allocationIndex];
      resourceAllocations.splice(allocationIndex, 1);
      this.logger.debug(`Released ${allocation.allocated} of ${resourceName} from ${requester}`);
    }
  }

  /**
   * Get current resource utilization
   */
  getCurrentAllocations(resourceName: string): number {
    const resourceAllocations = this.allocations.get(resourceName);
    if (!resourceAllocations) return 0;

    return resourceAllocations.reduce((total, alloc) => total + alloc.allocated, 0);
  }

  /**
   * Monitor resource usage and update metrics
   */
  private async monitorResources() {
    for (const [resourceName, resource] of this.resources) {
      const metrics = this.resourceMetrics.get(resourceName)!;
      const currentAllocations = this.getCurrentAllocations(resourceName);

      // Calculate utilization
      metrics.utilization = (currentAllocations / resource.currentCapacity) * 100;

      // Calculate contention (requests that couldn't be fulfilled)
      const recentAllocations = this.allocations.get(resourceName)!.filter(
        alloc => Date.now() - alloc.timestamp < 60000 // Last minute
      );
      const totalRequested = recentAllocations.reduce((sum, alloc) => sum + alloc.requested, 0);
      const totalAllocated = recentAllocations.reduce((sum, alloc) => sum + alloc.allocated, 0);
      metrics.contention = totalRequested > 0 ? ((totalRequested - totalAllocated) / totalRequested) * 100 : 0;

      // Update efficiency based on resource type
      await this.updateResourceEfficiency(resourceName, metrics);

      // Log warnings for high utilization
      if (metrics.utilization > 90) {
        this.logger.warn(`High resource utilization: ${resourceName} at ${metrics.utilization.toFixed(1)}%`);
      }

      if (metrics.contention > 20) {
        this.logger.warn(`High resource contention: ${resourceName} at ${metrics.contention.toFixed(1)}%`);
      }
    }
  }

  private async updateResourceEfficiency(resourceName: string, metrics: ResourceMetrics) {
    const resource = this.resources.get(resourceName)!;

    switch (resource.type) {
      case 'cpu':
        // CPU efficiency based on throughput vs utilization
        const perfMetrics = this.performanceService.getMetrics();
        metrics.efficiency = perfMetrics.throughput > 0 ? Math.min(perfMetrics.throughput / metrics.utilization, 1) : 1;
        break;

      case 'memory':
        // Memory efficiency based on garbage collection pressure
        const memUsage = process.memoryUsage();
        const memPressure = memUsage.heapUsed / memUsage.heapTotal;
        metrics.efficiency = Math.max(0, 1 - memPressure);
        break;

      case 'connection':
        // Connection efficiency based on pool utilization
        const pools = this.performanceService.getResourcePools();
        const pool = pools[resourceName];
        if (pool) {
          metrics.efficiency = pool.available / pool.currentSize;
        }
        break;

      default:
        metrics.efficiency = 1 - (metrics.contention / 100);
    }
  }

  /**
   * Attempt to scale resource capacity
   */
  private async attemptResourceScaling(resourceName: string, requestedAmount: number): Promise<boolean> {
    const resource = this.resources.get(resourceName);
    if (!resource || resource.allocationStrategy === 'static') {
      return false;
    }

    const currentAllocations = this.getCurrentAllocations(resourceName);
    const requiredCapacity = currentAllocations + requestedAmount;

    if (requiredCapacity <= resource.maxCapacity) {
      // Scale up
      const scaleAmount = Math.min(requiredCapacity - resource.currentCapacity, resource.maxCapacity - resource.currentCapacity);
      if (scaleAmount > 0) {
        resource.currentCapacity += scaleAmount;
        this.logger.log(`Scaled up ${resourceName} capacity to ${resource.currentCapacity}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Optimize resource allocation based on usage patterns
   */
  private async optimizeResourceAllocation() {
    for (const [resourceName, resource] of this.resources) {
      if (resource.allocationStrategy === 'static') continue;

      const metrics = this.resourceMetrics.get(resourceName)!;
      const currentAllocations = this.getCurrentAllocations(resourceName);

      // Scale down underutilized resources
      if (metrics.utilization < 30 && resource.currentCapacity > resource.minCapacity) {
        const scaleDown = Math.min(
          Math.floor((resource.currentCapacity - currentAllocations) * 0.5),
          resource.currentCapacity - resource.minCapacity
        );

        if (scaleDown > 0) {
          resource.currentCapacity -= scaleDown;
          this.logger.log(`Scaled down ${resourceName} capacity to ${resource.currentCapacity}`);
        }
      }

      // Scale up contended resources
      if (metrics.contention > 50 && resource.currentCapacity < resource.maxCapacity) {
        const scaleUp = Math.min(
          Math.floor(resource.currentCapacity * 0.25),
          resource.maxCapacity - resource.currentCapacity
        );

        if (scaleUp > 0) {
          resource.currentCapacity += scaleUp;
          this.logger.log(`Scaled up ${resourceName} capacity to ${resource.currentCapacity} (high contention)`);
        }
      }
    }
  }

  /**
   * Get resource status and metrics
   */
  getResourceStatus(): Record<string, {
    config: ResourceConfig;
    currentAllocations: number;
    metrics: ResourceMetrics;
    recentAllocations: ResourceAllocation[];
  }> {
    const result: Record<string, any> = {};

    for (const [resourceName, resource] of this.resources) {
      const allocations = this.allocations.get(resourceName)!;
      const recentAllocations = allocations.filter(
        alloc => Date.now() - alloc.timestamp < 300000 // Last 5 minutes
      );

      result[resourceName] = {
        config: { ...resource },
        currentAllocations: this.getCurrentAllocations(resourceName),
        metrics: { ...this.resourceMetrics.get(resourceName)! },
        recentAllocations,
      };
    }

    return result;
  }

  /**
   * Force resource scaling for maintenance
   */
  async forceResourceScaling(resourceName: string, newCapacity: number): Promise<boolean> {
    const resource = this.resources.get(resourceName);
    if (!resource) return false;

    const currentAllocations = this.getCurrentAllocations(resourceName);

    if (newCapacity >= currentAllocations && newCapacity >= resource.minCapacity && newCapacity <= resource.maxCapacity) {
      resource.currentCapacity = newCapacity;
      this.logger.log(`Force scaled ${resourceName} to ${newCapacity}`);
      return true;
    }

    return false;
  }

  /**
   * Get resource utilization forecast
   */
  getResourceForecast(resourceName: string, minutes: number = 5): {
    predictedUtilization: number;
    recommendedCapacity: number;
    confidence: number;
  } {
    const resource = this.resources.get(resourceName);
    if (!resource) {
      throw new Error(`Resource ${resourceName} not found`);
    }

    // Simple linear regression based on recent allocations
    const allocations = this.allocations.get(resourceName)!;
    const recentAllocations = allocations.filter(
      alloc => Date.now() - alloc.timestamp < minutes * 60 * 1000
    );

    if (recentAllocations.length < 2) {
      return {
        predictedUtilization: 0,
        recommendedCapacity: resource.currentCapacity,
        confidence: 0,
      };
    }

    // Calculate trend
    const avgAllocation = recentAllocations.reduce((sum, alloc) => sum + alloc.allocated, 0) / recentAllocations.length;
    const predictedUtilization = (avgAllocation / resource.currentCapacity) * 100;

    let recommendedCapacity = resource.currentCapacity;
    if (predictedUtilization > 80) {
      recommendedCapacity = Math.min(resource.currentCapacity * 1.2, resource.maxCapacity);
    } else if (predictedUtilization < 40) {
      recommendedCapacity = Math.max(resource.currentCapacity * 0.8, resource.minCapacity);
    }

    return {
      predictedUtilization,
      recommendedCapacity,
      confidence: Math.min(recentAllocations.length / 10, 1), // Confidence based on sample size
    };
  }
}
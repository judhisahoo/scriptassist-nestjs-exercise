import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Information about a cluster instance for horizontal scaling.
 * Contains connection details, lifecycle information, and runtime metadata.
 */
export interface InstanceInfo {
  /** Unique identifier for the instance */
  id: string;
  /** Hostname or IP address of the instance */
  host: string;
  /** Port number the instance is listening on */
  port: number;
  /** Timestamp when the instance started */
  startTime: number;
  /** Timestamp of the last heartbeat from this instance */
  lastHeartbeat: number;
  /** Current operational status of the instance */
  status: 'active' | 'inactive' | 'shutting_down';
  /** Additional metadata about the instance (version, memory usage, etc.) */
  metadata: Record<string, any>;
}

/**
 * Strategy for selecting instances in a load-balanced cluster.
 * Defines how to choose which instance should handle a request.
 */
export interface LoadBalancingStrategy {
  /** Unique name identifier for the strategy */
  name: string;
  /** Function that selects an instance from the available instances */
  selectInstance: (instances: InstanceInfo[], context?: any) => InstanceInfo | null;
}

/**
 * Service for managing horizontal scaling in a distributed cluster.
 * Handles instance registration, load balancing, leader election, and cluster coordination.
 *
 * @remarks
 * This service provides:
 * - Automatic instance registration and heartbeat monitoring
 * - Load balancing across cluster instances
 * - Leader election for coordinated operations
 * - Cluster statistics and health monitoring
 * - Graceful shutdown coordination
 */
@Injectable()
export class HorizontalScalingService implements OnModuleInit, OnModuleDestroy {
  /** Logger instance for horizontal scaling operations */
  private readonly logger = new Logger(HorizontalScalingService.name);

  /** Redis client for cluster coordination */
  private redisClient: Redis;

  /** Unique identifier for this instance */
  private instanceId: string;

  /** Interval for sending heartbeat signals */
  private heartbeatInterval: NodeJS.Timeout;

  /** Redis key for this instance's data */
  private instanceKey: string;

  /** Redis key for the set of active instances */
  private instancesKey: string;

  /** Map of registered load balancing strategies */
  private loadBalancingStrategies: Map<string, LoadBalancingStrategy> = new Map();

  /**
   * Creates an instance of HorizontalScalingService.
   *
   * @param configService - Service for accessing application configuration
   * @param distributedLockService - Service for distributed locking operations
   */
  constructor(
    private configService: ConfigService,
    private distributedLockService: DistributedLockService,
  ) {
    this.instanceId = this.generateInstanceId();
    this.instanceKey = `instance:${this.instanceId}`;
    this.instancesKey = 'instances:active';

    this.initializeRedis();
    this.registerDefaultStrategies();
  }

  async onModuleInit() {
    await this.registerInstance();
    this.startHeartbeat();
    this.logger.log(`Instance registered: ${this.instanceId}`);
  }

  async onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    await this.unregisterInstance();
    await this.redisClient.quit();
    this.logger.log(`Instance unregistered: ${this.instanceId}`);
  }

  /**
   * Registers this instance with the cluster by storing instance information in Redis.
   * Sets up automatic expiration and adds the instance to the active instances set.
   *
   * @private
   */
  private async registerInstance() {
    const instanceInfo: InstanceInfo = {
      id: this.instanceId,
      host: this.configService.get('HOST', 'localhost'),
      port: this.configService.get('PORT', 3000),
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'active',
      metadata: {
        version: process.version,
        platform: process.platform,
        pid: process.pid,
        memoryUsage: process.memoryUsage(),
      },
    };

    try {
      await this.redisClient.setex(
        this.instanceKey,
        300, // 5 minutes TTL
        JSON.stringify(instanceInfo),
      );

      await this.redisClient.sadd(this.instancesKey, this.instanceId);
      await this.redisClient.expire(this.instancesKey, 300);

      this.logger.debug(`Instance registered: ${this.instanceId}`);
    } catch (error) {
      this.logger.error('Failed to register instance:', error);
    }
  }

  /**
   * Removes this instance from the cluster by deleting its data from Redis.
   * Cleans up both the instance record and the active instances set.
   *
   * @private
   */
  private async unregisterInstance() {
    try {
      await this.redisClient.del(this.instanceKey);
      await this.redisClient.srem(this.instancesKey, this.instanceId);
      this.logger.debug(`Instance unregistered: ${this.instanceId}`);
    } catch (error) {
      this.logger.error('Failed to unregister instance:', error);
    }
  }

  /**
   * Starts the heartbeat mechanism to maintain instance registration.
   * Sends periodic updates to Redis to indicate the instance is still active.
   *
   * @private
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.updateHeartbeat();
      } catch (error) {
        this.logger.error('Heartbeat failed:', error);
      }
    }, 30000); // 30 seconds
  }

  /**
   * Updates the heartbeat timestamp and refreshes instance metadata.
   * Ensures the instance remains registered in the cluster by updating its TTL.
   *
   * @private
   */
  private async updateHeartbeat() {
    try {
      const instanceData = await this.redisClient.get(this.instanceKey);
      if (instanceData) {
        const instanceInfo: InstanceInfo = JSON.parse(instanceData);
        instanceInfo.lastHeartbeat = Date.now();
        instanceInfo.metadata.memoryUsage = process.memoryUsage();

        await this.redisClient.setex(
          this.instanceKey,
          300, // Refresh TTL
          JSON.stringify(instanceInfo),
        );
      }
    } catch (error) {
      this.logger.error('Failed to update heartbeat:', error);
    }
  }

  /**
   * Retrieves all currently active instances in the cluster.
   * Filters out instances that haven't sent heartbeats recently (stale instances).
   *
   * @returns Array of active InstanceInfo objects
   */
  async getActiveInstances(): Promise<InstanceInfo[]> {
    try {
      const instanceIds = await this.redisClient.smembers(this.instancesKey);
      const instances: InstanceInfo[] = [];

      for (const id of instanceIds) {
        const instanceData = await this.redisClient.get(`instance:${id}`);
        if (instanceData) {
          const instanceInfo: InstanceInfo = JSON.parse(instanceData);

          // Check if instance is still alive (heartbeat within 90 seconds)
          if (Date.now() - instanceInfo.lastHeartbeat < 90000) {
            instances.push(instanceInfo);
          } else {
            // Remove stale instance
            await this.redisClient.srem(this.instancesKey, id);
            await this.redisClient.del(`instance:${id}`);
            this.logger.warn(`Removed stale instance: ${id}`);
          }
        }
      }

      return instances;
    } catch (error) {
      this.logger.error('Failed to get active instances:', error);
      return [];
    }
  }

  /**
   * Selects an instance using the specified load balancing strategy.
   * Falls back to round-robin if the requested strategy is not available.
   *
   * @param strategyName - Name of the load balancing strategy to use
   * @param context - Optional context data for strategy selection
   * @returns Selected InstanceInfo or null if no instances are available
   */
  async selectInstance(
    strategyName: string = 'round-robin',
    context?: any,
  ): Promise<InstanceInfo | null> {
    const instances = await this.getActiveInstances();

    if (instances.length === 0) {
      return null;
    }

    if (instances.length === 1) {
      return instances[0];
    }

    const strategy = this.loadBalancingStrategies.get(strategyName);
    if (!strategy) {
      this.logger.warn(`Unknown load balancing strategy: ${strategyName}, using round-robin`);
      return this.roundRobinSelect(instances, context);
    }

    return strategy.selectInstance(instances, context);
  }

  /**
   * Registers a custom load balancing strategy for instance selection.
   * Strategies can be used to implement different load distribution algorithms.
   *
   * @param strategy - The load balancing strategy to register
   */
  registerStrategy(strategy: LoadBalancingStrategy) {
    this.loadBalancingStrategies.set(strategy.name, strategy);
    this.logger.log(`Load balancing strategy registered: ${strategy.name}`);
  }

  /**
   * Retrieves comprehensive statistics about the cluster instances.
   * Provides insights into cluster health, resource usage, and instance distribution.
   *
   * @returns Object containing cluster statistics including instance counts and resource usage
   */
  async getClusterStats(): Promise<{
    /** Total number of registered instances */
    totalInstances: number;
    /** Number of currently active instances */
    activeInstances: number;
    /** Average uptime of all instances in milliseconds */
    averageUptime: number;
    /** Memory usage statistics across the cluster */
    memoryUsage: { total: number; average: number };
  }> {
    const instances = await this.getActiveInstances();
    const now = Date.now();

    const totalInstances = instances.length;
    const activeInstances = instances.filter(i => i.status === 'active').length;
    const averageUptime = instances.length > 0
      ? instances.reduce((sum, i) => sum + (now - i.startTime), 0) / instances.length
      : 0;

    const totalMemory = instances.reduce((sum, i) => {
      const mem = i.metadata.memoryUsage as NodeJS.MemoryUsage;
      return sum + (mem ? mem.heapUsed : 0);
    }, 0);

    return {
      totalInstances,
      activeInstances,
      averageUptime,
      memoryUsage: {
        total: totalMemory,
        average: totalInstances > 0 ? totalMemory / totalInstances : 0,
      },
    };
  }

  /**
   * Broadcasts a message to all active instances in the cluster.
   * Uses Redis pub/sub for efficient message distribution.
   *
   * @param channel - The broadcast channel name
   * @param message - The message payload to broadcast
   */
  async broadcastMessage(channel: string, message: any): Promise<void> {
    try {
      await this.redisClient.publish(`broadcast:${channel}`, JSON.stringify(message));
      this.logger.debug(`Message broadcasted to channel: ${channel}`);
    } catch (error) {
      this.logger.error('Failed to broadcast message:', error);
    }
  }

  /**
   * Sends a message to a specific instance in the cluster.
   * Messages are stored temporarily in Redis with TTL for the target instance to retrieve.
   *
   * @param instanceId - The ID of the target instance
   * @param message - The message payload to send
   */
  async sendMessageToInstance(instanceId: string, message: any): Promise<void> {
    try {
      const messageKey = `message:${instanceId}:${Date.now()}`;
      await this.redisClient.setex(messageKey, 300, JSON.stringify(message)); // 5 minutes TTL
      this.logger.debug(`Message sent to instance: ${instanceId}`);
    } catch (error) {
      this.logger.error(`Failed to send message to instance ${instanceId}:`, error);
    }
  }

  /**
   * Checks if the current instance is the elected leader of the cluster.
   * Leadership is determined by a Redis key that indicates the current leader.
   *
   * @returns True if this instance is the leader, false otherwise
   */
  async isLeader(): Promise<boolean> {
    try {
      const leaderKey = 'cluster:leader';
      const currentLeader = await this.redisClient.get(leaderKey);

      return currentLeader === this.instanceId;
    } catch (error) {
      this.logger.error('Failed to check leader status:', error);
      return false;
    }
  }

  /**
   * Attempts to become the leader of the cluster using distributed locking.
   * Only one instance can successfully become leader at a time.
   *
   * @returns True if leadership was acquired, false otherwise
   */
  async attemptLeadership(): Promise<boolean> {
    const lockKey = 'cluster:leadership';
    const lockValue = await this.distributedLockService.acquireLock(
      lockKey,
      this.instanceId,
      { ttl: 60000 }, // 1 minute
    );

    if (lockValue) {
      try {
        const leaderKey = 'cluster:leader';
        await this.redisClient.setex(leaderKey, 60, this.instanceId); // 1 minute
        this.logger.log(`Instance became cluster leader: ${this.instanceId}`);
        return true;
      } catch (error) {
        this.logger.error('Failed to set leadership:', error);
        return false;
      } finally {
        await this.distributedLockService.releaseLock(lockKey, lockValue);
      }
    }

    return false;
  }

  /**
   * Prepares the instance for graceful shutdown by updating its status.
   * Allows other instances to stop routing work to this instance during shutdown.
   */
  async prepareShutdown(): Promise<void> {
    this.logger.log('Preparing for graceful shutdown');

    try {
      // Update status to shutting down
      const instanceData = await this.redisClient.get(this.instanceKey);
      if (instanceData) {
        const instanceInfo: InstanceInfo = JSON.parse(instanceData);
        instanceInfo.status = 'shutting_down';

        await this.redisClient.setex(
          this.instanceKey,
          60, // 1 minute for shutdown
          JSON.stringify(instanceInfo),
        );
      }

      // Stop accepting new work (implementation depends on your application)
      // This could involve setting flags, closing connections, etc.

      this.logger.log('Graceful shutdown preparation complete');
    } catch (error) {
      this.logger.error('Failed to prepare for shutdown:', error);
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
        this.logger.log('Horizontal scaling service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Horizontal scaling service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for horizontal scaling:', error);
    }
  }

  private registerDefaultStrategies() {
    // Round-robin strategy
    this.registerStrategy({
      name: 'round-robin',
      selectInstance: (instances) => {
        const now = Date.now();
        const index = now % instances.length;
        return instances[index];
      },
    });

    // Least-loaded strategy (based on memory usage)
    this.registerStrategy({
      name: 'least-loaded',
      selectInstance: (instances) => {
        let selectedInstance: InstanceInfo | null = null;
        let minLoad = Infinity;

        for (const instance of instances) {
          const memUsage = instance.metadata.memoryUsage as NodeJS.MemoryUsage;
          if (memUsage) {
            const load = memUsage.heapUsed / memUsage.heapTotal;
            if (load < minLoad) {
              minLoad = load;
              selectedInstance = instance;
            }
          }
        }

        return selectedInstance || instances[0];
      },
    });

    // Random strategy
    this.registerStrategy({
      name: 'random',
      selectInstance: (instances) => {
        const randomIndex = Math.floor(Math.random() * instances.length);
        return instances[randomIndex];
      },
    });
  }

  private roundRobinSelect(instances: InstanceInfo[], context?: any): InstanceInfo {
    const now = Date.now();
    const index = now % instances.length;
    return instances[index];
  }

  private generateInstanceId(): string {
    return `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
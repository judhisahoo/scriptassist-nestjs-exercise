import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DistributedLockService } from './distributed-lock.service';

export interface InstanceInfo {
  id: string;
  host: string;
  port: number;
  startTime: number;
  lastHeartbeat: number;
  status: 'active' | 'inactive' | 'shutting_down';
  metadata: Record<string, any>;
}

export interface LoadBalancingStrategy {
  name: string;
  selectInstance: (instances: InstanceInfo[], context?: any) => InstanceInfo | null;
}

@Injectable()
export class HorizontalScalingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizontalScalingService.name);
  private redisClient: Redis;
  private instanceId: string;
  private heartbeatInterval: NodeJS.Timeout;
  private instanceKey: string;
  private instancesKey: string;
  private loadBalancingStrategies: Map<string, LoadBalancingStrategy> = new Map();

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
   * Register this instance with the cluster
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
   * Unregister this instance from the cluster
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
   * Start heartbeat to maintain instance registration
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
   * Update heartbeat timestamp
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
   * Get all active instances
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
   * Select instance using load balancing strategy
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
   * Register custom load balancing strategy
   */
  registerStrategy(strategy: LoadBalancingStrategy) {
    this.loadBalancingStrategies.set(strategy.name, strategy);
    this.logger.log(`Load balancing strategy registered: ${strategy.name}`);
  }

  /**
   * Get instance statistics
   */
  async getClusterStats(): Promise<{
    totalInstances: number;
    activeInstances: number;
    averageUptime: number;
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
   * Broadcast message to all instances
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
   * Send message to specific instance
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
   * Check if current instance is the leader
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
   * Attempt to become cluster leader
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
   * Graceful shutdown preparation
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
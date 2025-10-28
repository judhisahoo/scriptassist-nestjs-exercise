import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DistributedLockService } from './distributed-lock.service';
import { HorizontalScalingService } from './horizontal-scaling.service';

export interface LeaderInfo {
  instanceId: string;
  electedAt: number;
  term: number;
  metadata: Record<string, any>;
}

export interface ScheduledTask {
  name: string;
  cronExpression: string;
  handler: () => Promise<void>;
  enabled: boolean;
  lastExecution?: number;
  nextExecution?: number;
}

@Injectable()
export class LeaderElectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderElectionService.name);
  private redisClient: Redis;
  private instanceId: string;
  private isLeader = false;
  private currentTerm = 0;
  private leaderKey = 'cluster:leader';
  private termKey = 'cluster:term';
  private leadershipRenewalInterval: NodeJS.Timeout;
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private taskExecutionIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private configService: ConfigService,
    private distributedLockService: DistributedLockService,
    private horizontalScalingService: HorizontalScalingService,
  ) {
    this.instanceId = this.horizontalScalingService['instanceId'] || this.generateInstanceId();
  }

  async onModuleInit() {
    await this.initializeRedis();
    await this.attemptLeadership();
    this.startLeadershipRenewal();
    this.logger.log(`Leader election service initialized: ${this.instanceId}`);
  }

  async onModuleDestroy() {
    if (this.leadershipRenewalInterval) {
      clearInterval(this.leadershipRenewalInterval);
    }

    // Clear all task execution intervals
    for (const interval of this.taskExecutionIntervals.values()) {
      clearInterval(interval);
    }

    if (this.isLeader) {
      await this.resignLeadership();
    }

    await this.redisClient.quit();
  }

  /**
   * Attempt to become the cluster leader
   */
  async attemptLeadership(): Promise<boolean> {
    const lockKey = 'leadership:election';
    const lockValue = await this.distributedLockService.acquireLock(
      lockKey,
      this.instanceId,
      { ttl: 30000 }, // 30 seconds
    );

    if (!lockValue) {
      this.logger.debug('Failed to acquire leadership election lock');
      return false;
    }

    try {
      // Get current term
      const currentTermStr = await this.redisClient.get(this.termKey);
      const currentTerm = currentTermStr ? parseInt(currentTermStr, 10) : 0;
      const newTerm = currentTerm + 1;

      // Try to become leader
      const leaderInfo: LeaderInfo = {
        instanceId: this.instanceId,
        electedAt: Date.now(),
        term: newTerm,
        metadata: {
          host: this.configService.get('HOST', 'localhost'),
          port: this.configService.get('PORT', 3000),
          uptime: process.uptime(),
        },
      };

      const result = await this.redisClient.set(
        this.leaderKey,
        JSON.stringify(leaderInfo),
        'EX',
        30, // 30 seconds TTL
        'NX', // Only set if not exists
      );

      if (result === 'OK') {
        // Successfully became leader
        this.isLeader = true;
        this.currentTerm = newTerm;

        // Update term
        await this.redisClient.set(this.termKey, newTerm.toString());

        // Start leader responsibilities
        await this.onBecameLeader();

        this.logger.log(`Became cluster leader for term ${newTerm}`);
        return true;
      } else {
        // Failed to become leader
        this.logger.debug(`Failed to become leader for term ${newTerm}`);
        return false;
      }
    } catch (error) {
      this.logger.error('Error during leadership election:', error);
      return false;
    } finally {
      await this.distributedLockService.releaseLock(lockKey, lockValue);
    }
  }

  /**
   * Resign from leadership
   */
  async resignLeadership(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    try {
      // Stop leader responsibilities
      await this.onResignedLeadership();

      // Clear leadership
      await this.redisClient.del(this.leaderKey);
      this.isLeader = false;

      this.logger.log('Resigned from leadership');

      // Try to elect new leader
      setTimeout(() => this.attemptLeadership(), 1000);
    } catch (error) {
      this.logger.error('Error resigning leadership:', error);
    }
  }

  /**
   * Check if current instance is the leader
   */
  async isCurrentInstanceLeader(): Promise<boolean> {
    if (!this.isLeader) {
      return false;
    }

    try {
      const leaderData = await this.redisClient.get(this.leaderKey);
      if (!leaderData) {
        this.isLeader = false;
        return false;
      }

      const leaderInfo: LeaderInfo = JSON.parse(leaderData);
      return leaderInfo.instanceId === this.instanceId;
    } catch (error) {
      this.logger.error('Error checking leadership status:', error);
      this.isLeader = false;
      return false;
    }
  }

  /**
   * Get current leader information
   */
  async getCurrentLeader(): Promise<LeaderInfo | null> {
    try {
      const leaderData = await this.redisClient.get(this.leaderKey);
      if (!leaderData) {
        return null;
      }

      return JSON.parse(leaderData) as LeaderInfo;
    } catch (error) {
      this.logger.error('Error getting current leader:', error);
      return null;
    }
  }

  /**
   * Register a scheduled task (only executed by leader)
   */
  registerScheduledTask(task: ScheduledTask): void {
    this.scheduledTasks.set(task.name, task);

    if (this.isLeader && task.enabled) {
      this.scheduleTask(task);
    }

    this.logger.log(`Scheduled task registered: ${task.name}`);
  }

  /**
   * Unregister a scheduled task
   */
  unregisterScheduledTask(taskName: string): void {
    const task = this.scheduledTasks.get(taskName);
    if (task) {
      const interval = this.taskExecutionIntervals.get(taskName);
      if (interval) {
        clearInterval(interval);
        this.taskExecutionIntervals.delete(taskName);
      }

      this.scheduledTasks.delete(taskName);
      this.logger.log(`Scheduled task unregistered: ${taskName}`);
    }
  }

  /**
   * Execute task only if current instance is leader
   */
  async executeIfLeader(taskName: string): Promise<boolean> {
    if (!await this.isCurrentInstanceLeader()) {
      return false;
    }

    const task = this.scheduledTasks.get(taskName);
    if (!task || !task.enabled) {
      return false;
    }

    try {
      this.logger.debug(`Executing scheduled task: ${taskName}`);
      await task.handler();
      task.lastExecution = Date.now();
      return true;
    } catch (error) {
      this.logger.error(`Error executing scheduled task ${taskName}:`, error);
      return false;
    }
  }

  /**
   * Get leadership statistics
   */
  async getLeadershipStats(): Promise<{
    isLeader: boolean;
    currentTerm: number;
    leaderInfo?: LeaderInfo;
    registeredTasks: number;
    activeTasks: number;
  }> {
    const leaderInfo = await this.getCurrentLeader();

    return {
      isLeader: this.isLeader,
      currentTerm: this.currentTerm,
      leaderInfo: leaderInfo || undefined,
      registeredTasks: this.scheduledTasks.size,
      activeTasks: this.taskExecutionIntervals.size,
    };
  }

  private async onBecameLeader(): Promise<void> {
    this.logger.log('Starting leader responsibilities');

    // Start all enabled scheduled tasks
    for (const task of this.scheduledTasks.values()) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }

    // Publish leadership event
    await this.redisClient.publish('leadership:events', JSON.stringify({
      event: 'leader_elected',
      leaderId: this.instanceId,
      term: this.currentTerm,
      timestamp: Date.now(),
    }));
  }

  private async onResignedLeadership(): Promise<void> {
    this.logger.log('Stopping leader responsibilities');

    // Stop all scheduled tasks
    for (const [taskName, interval] of this.taskExecutionIntervals) {
      clearInterval(interval);
      this.logger.debug(`Stopped scheduled task: ${taskName}`);
    }
    this.taskExecutionIntervals.clear();

    // Publish resignation event
    await this.redisClient.publish('leadership:events', JSON.stringify({
      event: 'leader_resigned',
      leaderId: this.instanceId,
      term: this.currentTerm,
      timestamp: Date.now(),
    }));
  }

  private startLeadershipRenewal(): void {
    this.leadershipRenewalInterval = setInterval(async () => {
      if (this.isLeader) {
        try {
          // Renew leadership
          const leaderInfo: LeaderInfo = {
            instanceId: this.instanceId,
            electedAt: Date.now(),
            term: this.currentTerm,
            metadata: {
              host: this.configService.get('HOST', 'localhost'),
              port: this.configService.get('PORT', 3000),
              uptime: process.uptime(),
            },
          };

          await this.redisClient.setex(
            this.leaderKey,
            30, // 30 seconds
            JSON.stringify(leaderInfo),
          );
        } catch (error) {
          this.logger.error('Failed to renew leadership:', error);
          this.isLeader = false;
        }
      } else {
        // Try to become leader if none exists
        const currentLeader = await this.getCurrentLeader();
        if (!currentLeader) {
          await this.attemptLeadership();
        }
      }
    }, 10000); // Check every 10 seconds
  }

  private scheduleTask(task: ScheduledTask): void {
    // Simple scheduling - in production, you'd use a proper cron library
    const interval = this.parseCronExpression(task.cronExpression);

    if (interval > 0) {
      const executionInterval = setInterval(async () => {
        await this.executeIfLeader(task.name);
      }, interval);

      this.taskExecutionIntervals.set(task.name, executionInterval);
      this.logger.debug(`Scheduled task started: ${task.name} (${interval}ms interval)`);
    }
  }

  private parseCronExpression(cronExpression: string): number {
    // Very basic cron parsing - in production, use a proper cron library
    const parts = cronExpression.split(' ');

    if (parts.length >= 1) {
      const minute = parts[0];

      if (minute === '*' || minute === '*/1') {
        return 60000; // Every minute
      }

      if (minute.startsWith('*/')) {
        const interval = parseInt(minute.substring(2), 10);
        return interval * 60000; // Convert to milliseconds
      }

      const minuteNum = parseInt(minute, 10);
      if (!isNaN(minuteNum)) {
        return minuteNum * 60000;
      }
    }

    // Default to every 5 minutes
    return 300000;
  }

  private async initializeRedis() {
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
        this.logger.log('Leader election service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Leader election service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for leader election:', error);
    }
  }

  private generateInstanceId(): string {
    return `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
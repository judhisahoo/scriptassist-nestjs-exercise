import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HorizontalScalingService } from './horizontal-scaling.service';
import { DistributedLockService } from './distributed-lock.service';

export interface CoordinationMessage {
  type: string;
  from: string;
  to?: string;
  payload: any;
  timestamp: number;
  correlationId?: string;
}

export interface CoordinationEvent {
  eventType: string;
  instanceId: string;
  data: any;
  timestamp: number;
}

@Injectable()
export class InstanceCoordinationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceCoordinationService.name);
  private redisClient: Redis;
  private subscriber: Redis;
  private instanceId: string;
  private coordinationChannel: string;
  private eventChannel: string;
  private messageHandlers: Map<string, (message: CoordinationMessage) => Promise<void>> = new Map();
  private eventListeners: Map<string, (event: CoordinationEvent) => void> = new Map();

  constructor(
    private configService: ConfigService,
    private horizontalScalingService: HorizontalScalingService,
    private distributedLockService: DistributedLockService,
  ) {
    this.instanceId = this.horizontalScalingService['instanceId'] || this.generateInstanceId();
    this.coordinationChannel = 'coordination:messages';
    this.eventChannel = 'coordination:events';

    this.initializeRedis();
    this.registerDefaultHandlers();
  }

  async onModuleInit() {
    await this.setupMessageSubscription();
    await this.setupEventSubscription();
    this.logger.log(`Instance coordination initialized: ${this.instanceId}`);
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      this.subscriber.quit();
    }
    if (this.redisClient) {
      this.redisClient.quit();
    }
  }

  /**
   * Send message to all instances
   */
  async broadcastMessage(type: string, payload: any, correlationId?: string): Promise<void> {
    const message: CoordinationMessage = {
      type,
      from: this.instanceId,
      payload,
      timestamp: Date.now(),
      correlationId,
    };

    try {
      await this.redisClient.publish(this.coordinationChannel, JSON.stringify(message));
      this.logger.debug(`Message broadcasted: ${type}`);
    } catch (error) {
      this.logger.error('Failed to broadcast message:', error);
    }
  }

  /**
   * Send message to specific instance
   */
  async sendMessageToInstance(
    targetInstanceId: string,
    type: string,
    payload: any,
    correlationId?: string,
  ): Promise<void> {
    const message: CoordinationMessage = {
      type,
      from: this.instanceId,
      to: targetInstanceId,
      payload,
      timestamp: Date.now(),
      correlationId,
    };

    try {
      await this.redisClient.publish(this.coordinationChannel, JSON.stringify(message));
      this.logger.debug(`Message sent to ${targetInstanceId}: ${type}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${targetInstanceId}:`, error);
    }
  }

  /**
   * Publish coordination event
   */
  async publishEvent(eventType: string, data: any): Promise<void> {
    const event: CoordinationEvent = {
      eventType,
      instanceId: this.instanceId,
      data,
      timestamp: Date.now(),
    };

    try {
      await this.redisClient.publish(this.eventChannel, JSON.stringify(event));
      this.logger.debug(`Event published: ${eventType}`);
    } catch (error) {
      this.logger.error('Failed to publish event:', error);
    }
  }

  /**
   * Register message handler
   */
  registerMessageHandler(type: string, handler: (message: CoordinationMessage) => Promise<void>) {
    this.messageHandlers.set(type, handler);
    this.logger.log(`Message handler registered: ${type}`);
  }

  /**
   * Register event listener
   */
  registerEventListener(eventType: string, listener: (event: CoordinationEvent) => void) {
    this.eventListeners.set(eventType, listener);
    this.logger.log(`Event listener registered: ${eventType}`);
  }

  /**
   * Request response pattern - send request and wait for response
   */
  async requestResponse(
    targetInstanceId: string,
    requestType: string,
    payload: any,
    timeout: number = 30000,
  ): Promise<any> {
    const correlationId = this.generateCorrelationId();
    let responseResolver: (value: any) => void;
    let responseRejector: (reason: any) => void;

    const responsePromise = new Promise((resolve, reject) => {
      responseResolver = resolve;
      responseRejector = reject;
    });

    // Register temporary response handler
    const responseHandler = async (message: CoordinationMessage) => {
      if (message.correlationId === correlationId) {
        responseResolver(message.payload);
        // Remove handler after use
        this.messageHandlers.delete(`${requestType}:response`);
      }
    };

    this.registerMessageHandler(`${requestType}:response`, responseHandler);

    // Send request
    await this.sendMessageToInstance(targetInstanceId, requestType, payload, correlationId);

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      this.messageHandlers.delete(`${requestType}:response`);
      responseRejector(new Error(`Request timeout: ${requestType}`));
    }, timeout);

    try {
      const response = await responsePromise;
      clearTimeout(timeoutHandle);
      return response;
    } catch (error) {
      clearTimeout(timeoutHandle);
      throw error;
    }
  }

  /**
   * Send response to a request
   */
  async sendResponse(
    targetInstanceId: string,
    originalRequestType: string,
    payload: any,
    correlationId: string,
  ): Promise<void> {
    await this.sendMessageToInstance(
      targetInstanceId,
      `${originalRequestType}:response`,
      payload,
      correlationId,
    );
  }

  /**
   * Coordinate distributed operation across instances
   */
  async coordinateDistributedOperation<T>(
    operationId: string,
    operation: () => Promise<T>,
    options: {
      requiredInstances?: number;
      timeout?: number;
      consensusRequired?: boolean;
    } = {},
  ): Promise<T> {
    const { requiredInstances = 1, timeout = 30000, consensusRequired = false } = options;

    // Get active instances
    const activeInstances = await this.horizontalScalingService.getActiveInstances();

    if (activeInstances.length < requiredInstances) {
      throw new Error(
        `Not enough active instances: ${activeInstances.length}/${requiredInstances}`,
      );
    }

    if (consensusRequired) {
      // Implement consensus algorithm (simplified)
      const consensus = await this.achieveConsensus(operationId, activeInstances, timeout);
      if (!consensus) {
        throw new Error('Failed to achieve consensus');
      }
    }

    // Use distributed lock to coordinate
    const lockKey = `operation:${operationId}`;
    const lockValue = await this.distributedLockService.acquireLock(
      lockKey,
      this.instanceId,
      { ttl: timeout },
    );

    if (!lockValue) {
      throw new Error(`Failed to acquire coordination lock: ${operationId}`);
    }

    try {
      // Notify other instances about the operation
      await this.publishEvent('operation_started', {
        operationId,
        instanceId: this.instanceId,
      });

      const result = await operation();

      // Notify completion
      await this.publishEvent('operation_completed', {
        operationId,
        instanceId: this.instanceId,
        result: typeof result === 'object' ? {} : result, // Avoid large objects
      });

      return result;
    } finally {
      await this.distributedLockService.releaseLock(lockKey, lockValue);
    }
  }

  /**
   * Health check coordination across instances
   */
  async coordinatedHealthCheck(): Promise<{
    instanceHealth: any;
    clusterHealth: any;
  }> {
    const instanceHealth = {
      id: this.instanceId,
      status: 'healthy',
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };

    const clusterStats = await this.horizontalScalingService.getClusterStats();

    return {
      instanceHealth,
      clusterHealth: clusterStats,
    };
  }

  /**
   * Graceful shutdown coordination
   */
  async coordinateShutdown(reason: string = 'maintenance'): Promise<void> {
    this.logger.log(`Coordinating shutdown: ${reason}`);

    // Notify other instances
    await this.publishEvent('instance_shutting_down', {
      instanceId: this.instanceId,
      reason,
      timestamp: Date.now(),
    });

    // Wait for acknowledgments (simplified)
    await this.delay(2000);

    // Prepare for shutdown
    await this.horizontalScalingService.prepareShutdown();
  }

  private async setupMessageSubscription() {
    this.subscriber.on('message', async (channel, messageData) => {
      if (channel === this.coordinationChannel) {
        try {
          const message: CoordinationMessage = JSON.parse(messageData);

          // Only process messages intended for this instance or broadcasts
          if (!message.to || message.to === this.instanceId) {
            await this.handleMessage(message);
          }
        } catch (error) {
          this.logger.error('Error processing coordination message:', error);
        }
      }
    });

    await this.subscriber.subscribe(this.coordinationChannel);
  }

  private async setupEventSubscription() {
    this.subscriber.on('message', (channel, eventData) => {
      if (channel === this.eventChannel) {
        try {
          const event: CoordinationEvent = JSON.parse(eventData);
          this.handleEvent(event);
        } catch (error) {
          this.logger.error('Error processing coordination event:', error);
        }
      }
    });

    await this.subscriber.subscribe(this.eventChannel);
  }

  private async handleMessage(message: CoordinationMessage) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        await handler(message);
      } catch (error) {
        this.logger.error(`Error in message handler ${message.type}:`, error);
      }
    } else {
      this.logger.warn(`No handler for message type: ${message.type}`);
    }
  }

  private handleEvent(event: CoordinationEvent) {
    const listener = this.eventListeners.get(event.eventType);
    if (listener) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(`Error in event listener ${event.eventType}:`, error);
      }
    }
  }

  private registerDefaultHandlers() {
    // Health check request handler
    this.registerMessageHandler('health_check', async (message) => {
      const health = await this.coordinatedHealthCheck();
      await this.sendResponse(message.from, 'health_check', health, message.correlationId!);
    });

    // Shutdown coordination handler
    this.registerMessageHandler('prepare_shutdown', async (message) => {
      this.logger.log(`Received shutdown preparation from ${message.from}`);
      // Acknowledge shutdown preparation
      await this.sendResponse(message.from, 'prepare_shutdown', { acknowledged: true }, message.correlationId!);
    });

    // Default event listeners
    this.registerEventListener('instance_shutting_down', (event) => {
      this.logger.log(`Instance shutting down: ${event.instanceId} (${event.data.reason})`);
    });

    this.registerEventListener('operation_started', (event) => {
      this.logger.debug(`Operation started: ${event.data.operationId} by ${event.instanceId}`);
    });

    this.registerEventListener('operation_completed', (event) => {
      this.logger.debug(`Operation completed: ${event.data.operationId} by ${event.instanceId}`);
    });
  }

  private async achieveConsensus(
    operationId: string,
    instances: any[],
    timeout: number,
  ): Promise<boolean> {
    // Simplified consensus implementation
    // In a real implementation, you might use Paxos, Raft, or similar
    const consensusKey = `consensus:${operationId}`;
    const requiredVotes = Math.ceil(instances.length / 2);

    try {
      // Try to get consensus lock
      const lockValue = await this.distributedLockService.acquireLock(
        consensusKey,
        this.instanceId,
        { ttl: timeout },
      );

      if (lockValue) {
        // This instance is the coordinator
        const votes = await this.collectVotes(operationId, instances, timeout);
        await this.distributedLockService.releaseLock(consensusKey, lockValue);

        return votes >= requiredVotes;
      } else {
        // Wait for consensus result
        return await this.waitForConsensusResult(operationId, timeout);
      }
    } catch (error) {
      this.logger.error(`Consensus failed for ${operationId}:`, error);
      return false;
    }
  }

  private async collectVotes(operationId: string, instances: any[], timeout: number): Promise<number> {
    // Simplified voting - in practice, you'd implement proper distributed consensus
    let votes = 1; // This instance votes yes

    // Send vote requests to other instances
    const votePromises = instances
      .filter(i => i.id !== this.instanceId)
      .map(instance =>
        this.requestResponse(instance.id, 'vote_request', { operationId }, timeout / 2)
          .then(() => 1)
          .catch(() => 0),
      );

    const voteResults = await Promise.all(votePromises);
    votes += voteResults.reduce((sum, vote) => sum + vote, 0);

    return votes;
  }

  private async waitForConsensusResult(operationId: string, timeout: number): Promise<boolean> {
    // Wait for consensus result from coordinator
    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.eventListeners.delete(`consensus:${operationId}`);
        resolve(false);
      }, timeout);

      this.registerEventListener(`consensus:${operationId}`, (event) => {
        clearTimeout(timeoutHandle);
        this.eventListeners.delete(`consensus:${operationId}`);
        resolve(event.data.result);
      });
    });
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
      this.subscriber = this.redisClient.duplicate();

      this.redisClient.on('connect', () => {
        this.logger.log('Instance coordination service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Instance coordination service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for instance coordination:', error);
    }
  }

  private generateInstanceId(): string {
    return `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
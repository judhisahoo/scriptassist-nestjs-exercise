import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HorizontalScalingService } from './horizontal-scaling.service';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Message structure for inter-instance coordination.
 * Used for request/response patterns and direct messaging between instances.
 */
export interface CoordinationMessage {
  /** Message type identifier */
  type: string;
  /** ID of the instance that sent the message */
  from: string;
  /** Optional target instance ID (for direct messages) */
  to?: string;
  /** Message payload data */
  payload: any;
  /** Timestamp when the message was sent */
  timestamp: number;
  /** Optional correlation ID for request/response tracking */
  correlationId?: string;
}

/**
 * Event structure for cluster-wide coordination events.
 * Used for broadcasting state changes and notifications across all instances.
 */
export interface CoordinationEvent {
  /** Type of event being broadcast */
  eventType: string;
  /** ID of the instance that generated the event */
  instanceId: string;
  /** Event-specific data payload */
  data: any;
  /** Timestamp when the event occurred */
  timestamp: number;
}

/**
 * Service for coordinating operations across multiple application instances.
 * Provides messaging, event broadcasting, and consensus mechanisms for distributed systems.
 *
 * @remarks
 * This service supports:
 * - Inter-instance messaging with request/response patterns
 * - Event broadcasting for cluster-wide notifications
 * - Distributed consensus for coordinated operations
 * - Health check coordination and graceful shutdown
 */
@Injectable()
export class InstanceCoordinationService implements OnModuleInit, OnModuleDestroy {
  /** Logger instance for coordination operations */
  private readonly logger = new Logger(InstanceCoordinationService.name);

  /** Redis client for publishing messages and events */
  private redisClient: Redis;

  /** Separate Redis connection for subscribing to messages and events */
  private subscriber: Redis;

  /** Unique identifier for this instance */
  private instanceId: string;

  /** Redis pub/sub channel for coordination messages */
  private coordinationChannel: string;

  /** Redis pub/sub channel for coordination events */
  private eventChannel: string;

  /** Map of registered message handlers by message type */
  private messageHandlers: Map<string, (message: CoordinationMessage) => Promise<void>> = new Map();

  /** Map of registered event listeners by event type */
  private eventListeners: Map<string, (event: CoordinationEvent) => void> = new Map();

  /**
   * Creates an instance of InstanceCoordinationService.
   *
   * @param configService - Service for accessing application configuration
   * @param horizontalScalingService - Service for cluster instance management
   * @param distributedLockService - Service for distributed locking operations
   */
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
   * Broadcasts a message to all instances in the cluster.
   * Messages are published to the coordination channel and received by all subscribers.
   *
   * @param type - Message type identifier
   * @param payload - Message payload data
   * @param correlationId - Optional correlation ID for tracking
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
   * Sends a message to a specific instance in the cluster.
   * The message will only be processed by the target instance.
   *
   * @param targetInstanceId - ID of the target instance
   * @param type - Message type identifier
   * @param payload - Message payload data
   * @param correlationId - Optional correlation ID for tracking
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
   * Publishes a coordination event to all instances in the cluster.
   * Events are broadcast to notify other instances of state changes or important occurrences.
   *
   * @param eventType - Type of event being published
   * @param data - Event-specific data payload
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
   * Registers a handler for processing incoming coordination messages.
   * Handlers are called when messages of the specified type are received.
   *
   * @param type - Message type to handle
   * @param handler - Async function to process messages of this type
   */
  registerMessageHandler(type: string, handler: (message: CoordinationMessage) => Promise<void>) {
    this.messageHandlers.set(type, handler);
    this.logger.log(`Message handler registered: ${type}`);
  }

  /**
   * Registers a listener for coordination events.
   * Listeners are called when events of the specified type are published by any instance.
   *
   * @param eventType - Type of event to listen for
   * @param listener - Function called when events of this type are received
   */
  registerEventListener(eventType: string, listener: (event: CoordinationEvent) => void) {
    this.eventListeners.set(eventType, listener);
    this.logger.log(`Event listener registered: ${eventType}`);
  }

  /**
   * Implements a request-response pattern for inter-instance communication.
   * Sends a request to a target instance and waits for a response with timeout handling.
   *
   * @param targetInstanceId - ID of the instance to send the request to
   * @param requestType - Type of request being made
   * @param payload - Request payload data
   * @param timeout - Maximum time to wait for response in milliseconds
   * @returns The response payload from the target instance
   * @throws Error if timeout is exceeded or request fails
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
   * Sends a response to a previously received request.
   * Used in request-response patterns to complete the communication cycle.
   *
   * @param targetInstanceId - ID of the instance that sent the original request
   * @param originalRequestType - Type of the original request
   * @param payload - Response payload data
   * @param correlationId - Correlation ID from the original request
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
   * Coordinates a distributed operation across multiple instances.
   * Ensures the required number of instances are available and optionally achieves consensus.
   *
   * @param operationId - Unique identifier for the operation
   * @param operation - The operation to execute
   * @param options - Configuration options for coordination
   * @returns The result of the operation
   * @throws Error if coordination requirements are not met
   */
  async coordinateDistributedOperation<T>(
    operationId: string,
    operation: () => Promise<T>,
    options: {
      /** Minimum number of instances required */
      requiredInstances?: number;
      /** Maximum time for the operation in milliseconds */
      timeout?: number;
      /** Whether consensus among instances is required */
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
   * Performs a coordinated health check across instances.
   * Gathers both instance-specific and cluster-wide health information.
   *
   * @returns Object containing instance and cluster health data
   */
  async coordinatedHealthCheck(): Promise<{
    /** Health information for this instance */
    instanceHealth: any;
    /** Overall cluster health statistics */
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
   * Coordinates graceful shutdown across the cluster.
   * Notifies other instances and waits for acknowledgments before proceeding.
   *
   * @param reason - Reason for the shutdown (e.g., 'maintenance', 'scaling')
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
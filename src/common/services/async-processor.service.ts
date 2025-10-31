import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

/**
 * Represents an asynchronous task to be processed by the async processor service.
 * Tasks can have different priorities, retry policies, and callback functions.
 */
export interface AsyncTask {
  /** Unique identifier for the task */
  id: string;
  /** Type of task that determines which processor handles it */
  type: string;
  /** Priority level affecting processing order: 'low', 'normal', 'high', or 'critical' */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Data payload to be processed by the task */
  data: any;
  /** Timestamp when the task was created */
  createdAt: number;
  /** Number of retry attempts made so far */
  retries: number;
  /** Maximum number of retry attempts allowed */
  maxRetries: number;
  /** Optional timeout in milliseconds for task processing */
  timeout?: number;
  /** Optional callback function called on successful completion */
  callback?: (result: any) => void;
  /** Optional callback function called on error or failure */
  errorCallback?: (error: Error) => void;
}

/**
 * Result of processing an asynchronous task, containing success status,
 * result data, error information, and performance metrics.
 */
export interface ProcessingResult {
  /** ID of the processed task */
  taskId: string;
  /** Whether the task completed successfully */
  success: boolean;
  /** Result data returned by the task processor (if successful) */
  result?: any;
  /** Error message if the task failed */
  error?: string;
  /** Total time taken to process the task in milliseconds */
  processingTime: number;
  /** Number of retry attempts made */
  retries: number;
}

/**
 * Metrics and statistics for the async processing queue system,
 * providing insights into performance, throughput, and system health.
 */
export interface QueueMetrics {
  /** Total number of tasks currently in all queues */
  queueLength: number;
  /** Rate of task processing (tasks per minute) */
  processingRate: number;
  /** Average time taken to process successful tasks in milliseconds */
  averageProcessingTime: number;
  /** Percentage of tasks that failed in the recent period */
  errorRate: number;
  /** Number of worker threads currently active */
  activeWorkers: number;
  /** Total number of tasks waiting in queues (alias for queueLength) */
  queuedTasks: number;
}

/**
 * Asynchronous task processor service that manages background task execution
 * with priority queuing, retry mechanisms, and performance monitoring.
 *
 * Features:
 * - Priority-based task queuing (critical, high, normal, low)
 * - Configurable retry policies with exponential backoff
 * - Timeout handling for long-running tasks
 * - Adaptive worker scaling based on queue load
 * - Comprehensive metrics and monitoring
 * - Callback support for task completion
 */
@Injectable()
export class AsyncProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsyncProcessorService.name);

  /** Legacy queue - kept for backward compatibility */
  private taskQueue: AsyncTask[] = [];

  /** Storage for completed task results */
  private processingResults: ProcessingResult[] = [];

  /** Number of currently active worker threads */
  private activeWorkers = 0;

  /** Maximum number of concurrent workers */
  private maxWorkers: number;

  /** Interval for processing queued tasks */
  private processingInterval: NodeJS.Timeout;

  /** Interval for collecting and logging metrics */
  private metricsInterval: NodeJS.Timeout;

  /** Flag to control processing (can be paused for maintenance) */
  private isProcessing = true;

  /** Priority queues for different task importance levels */
  private criticalQueue: AsyncTask[] = [];
  private highQueue: AsyncTask[] = [];
  private normalQueue: AsyncTask[] = [];
  private lowQueue: AsyncTask[] = [];

  constructor(
    private configService: ConfigService,
    private performanceService: PerformanceOptimizationService,
  ) {
    this.maxWorkers = this.configService.get('MAX_ASYNC_WORKERS', 10);
  }

  /**
   * Initializes the async processor service by starting task processing
   * and metrics collection routines.
   */
  async onModuleInit() {
    this.startProcessing();
    this.startMetricsCollection();
    this.logger.log(`Async processor initialized with ${this.maxWorkers} max workers`);
  }

  /**
   * Cleans up resources when the service is being destroyed.
   * Stops all intervals and prevents new task processing.
   */
  async onModuleDestroy() {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  /**
   * Submits a task for asynchronous processing with configurable options.
   * Tasks are queued based on priority and processed by registered processors.
   *
   * @param type - The type of task that determines which processor handles it
   * @param data - The data payload to be processed
   * @param options - Configuration options for task processing
   * @returns Promise resolving to the unique task ID
   */
  async submitTask(
    type: string,
    data: any,
    options: {
      priority?: 'low' | 'normal' | 'high' | 'critical';
      maxRetries?: number;
      timeout?: number;
      callback?: (result: any) => void;
      errorCallback?: (error: Error) => void;
    } = {},
  ): Promise<string> {
    const { priority = 'normal', maxRetries = 3, timeout, callback, errorCallback } = options;

    const task: AsyncTask = {
      id: this.generateTaskId(),
      type,
      priority,
      data,
      createdAt: Date.now(),
      retries: 0,
      maxRetries,
      timeout,
      callback,
      errorCallback,
    };

    // Add to appropriate priority queue
    this.addToPriorityQueue(task);

    this.logger.debug(`Task submitted: ${task.id} (${type}) with priority ${priority}`);
    return task.id;
  }

  /**
   * Submits multiple tasks in a batch for efficient bulk processing.
   * All tasks are submitted individually but can share common configuration.
   *
   * @param tasks - Array of task configurations to submit
   * @returns Promise resolving to array of task IDs in the same order as input
   */
  async submitBatch(
    tasks: Array<{
      type: string;
      data: any;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      maxRetries?: number;
      timeout?: number;
    }>,
  ): Promise<string[]> {
    const taskIds: string[] = [];

    for (const taskData of tasks) {
      const taskId = await this.submitTask(taskData.type, taskData.data, {
        priority: taskData.priority,
        maxRetries: taskData.maxRetries,
        timeout: taskData.timeout,
      });
      taskIds.push(taskId);
    }

    this.logger.debug(`Batch submitted: ${taskIds.length} tasks`);
    return taskIds;
  }

  /**
   * Retrieves the current status and details of a submitted task.
   * Checks completed tasks first, then searches through priority queues.
   *
   * @param taskId - The unique identifier of the task to check
   * @returns Object containing task status, queue position, and result if completed
   */
  getTaskStatus(taskId: string): {
    found: boolean;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    result?: ProcessingResult;
    queue?: string;
    position?: number;
  } {
    // Check if completed
    const result = this.processingResults.find(r => r.taskId === taskId);
    if (result) {
      return {
        found: true,
        status: result.success ? 'completed' : 'failed',
        result,
      };
    }

    // Check queues
    const queues = [
      { name: 'critical', queue: this.criticalQueue },
      { name: 'high', queue: this.highQueue },
      { name: 'normal', queue: this.normalQueue },
      { name: 'low', queue: this.lowQueue },
    ];

    for (const { name, queue } of queues) {
      const index = queue.findIndex(task => task.id === taskId);
      if (index > -1) {
        return {
          found: true,
          status: 'queued',
          queue: name,
          position: index,
        };
      }
    }

    // Check if currently processing (simplified - would need worker tracking)
    return {
      found: false,
      status: 'queued',
    };
  }

  /**
   * Cancels a queued task if it hasn't started processing yet.
   * Searches through all priority queues to find and remove the task.
   *
   * @param taskId - The unique identifier of the task to cancel
   * @returns True if the task was found and cancelled, false otherwise
   */
  cancelTask(taskId: string): boolean {
    const queues = [this.criticalQueue, this.highQueue, this.normalQueue, this.lowQueue];

    for (const queue of queues) {
      const index = queue.findIndex(task => task.id === taskId);
      if (index > -1) {
        const task = queue.splice(index, 1)[0];
        this.logger.debug(`Task cancelled: ${taskId}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Retrieves comprehensive metrics about the current state of the async processing system.
   * Includes queue lengths, processing rates, error rates, and worker utilization.
   *
   * @returns Detailed metrics about queue performance and system health
   */
  getQueueMetrics(): QueueMetrics {
    const totalQueued = this.criticalQueue.length + this.highQueue.length +
                        this.normalQueue.length + this.lowQueue.length;

    const recentResults = this.processingResults.filter(
      result => Date.now() - result.processingTime < 300000 // Last 5 minutes
    );

    const successfulResults = recentResults.filter(r => r.success);
    const averageProcessingTime = successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.processingTime, 0) / successfulResults.length
      : 0;

    const errorRate = recentResults.length > 0
      ? ((recentResults.length - successfulResults.length) / recentResults.length) * 100
      : 0;

    return {
      queueLength: totalQueued,
      processingRate: recentResults.length / 5, // per minute
      averageProcessingTime,
      errorRate,
      activeWorkers: this.activeWorkers,
      queuedTasks: totalQueued,
    };
  }

  /**
   * Registers a processor function for handling specific task types.
   * Processors are stored dynamically and called when tasks of matching type are processed.
   *
   * @param taskType - The type of task this processor handles
   * @param processor - Async function that processes task data and returns a result
   */
  registerProcessor(taskType: string, processor: (data: any) => Promise<any>) {
    // Store processor functions (simplified - would use a Map in real implementation)
    (this as any)[`process_${taskType}`] = processor;
    this.logger.log(`Processor registered for task type: ${taskType}`);
  }

  /**
   * Adds a task to the appropriate priority queue based on its priority level.
   * Critical tasks get highest priority, followed by high, normal, and low priority tasks.
   *
   * @param task - The async task to add to the queue
   */
  private addToPriorityQueue(task: AsyncTask) {
    switch (task.priority) {
      case 'critical':
        this.criticalQueue.push(task);
        break;
      case 'high':
        this.highQueue.push(task);
        break;
      case 'low':
        this.lowQueue.push(task);
        break;
      default:
        this.normalQueue.push(task);
    }
  }

  /**
   * Starts the main processing loop that continuously processes queued tasks.
   * Runs at regular intervals to check for new tasks and process them.
   */
  private startProcessing() {
    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing) return;

      await this.processNextBatch();
    }, 100); // Process every 100ms
  }

  /**
   * Processes the next batch of tasks if workers are available.
   * Ensures the number of active workers doesn't exceed the configured maximum.
   */
  private async processNextBatch() {
    // Don't exceed max workers
    if (this.activeWorkers >= this.maxWorkers) {
      return;
    }

    // Process tasks in priority order
    const task = this.getNextTask();
    if (!task) {
      return;
    }

    this.activeWorkers++;
    this.processTask(task).finally(() => {
      this.activeWorkers--;
    });
  }

  /**
   * Retrieves the next task to process based on priority order.
   * Critical tasks are processed first, followed by high, normal, and low priority tasks.
   *
   * @returns The next task to process, or null if no tasks are queued
   */
  private getNextTask(): AsyncTask | null {
    // Priority order: critical > high > normal > low
    return this.criticalQueue.shift() ||
           this.highQueue.shift() ||
           this.normalQueue.shift() ||
           this.lowQueue.shift() ||
           null;
  }

  /**
   * Processes a single task using the registered processor for its type.
   * Handles timeouts, retries with exponential backoff, and callback execution.
   *
   * @param task - The async task to process
   */
  private async processTask(task: AsyncTask): Promise<void> {
    const startTime = Date.now();

    try {
      // Get the processor for this task type
      const processor = (this as any)[`process_${task.type}`];
      if (!processor) {
        throw new Error(`No processor registered for task type: ${task.type}`);
      }

      // Apply timeout if specified
      let result: any;
      if (task.timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Task timeout')), task.timeout);
        });

        result = await Promise.race([
          processor(task.data),
          timeoutPromise,
        ]);
      } else {
        result = await processor(task.data);
      }

      const processingTime = Date.now() - startTime;

      // Record success
      const processingResult: ProcessingResult = {
        taskId: task.id,
        success: true,
        result,
        processingTime,
        retries: task.retries,
      };

      this.processingResults.push(processingResult);

      // Call success callback
      if (task.callback) {
        try {
          task.callback(result);
        } catch (callbackError) {
          this.logger.error(`Error in success callback for task ${task.id}:`, callbackError);
        }
      }

      this.logger.debug(`Task completed: ${task.id} (${processingTime}ms)`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      // Handle retries
      if (task.retries < task.maxRetries) {
        task.retries++;
        this.logger.warn(`Task failed, retrying (${task.retries}/${task.maxRetries}): ${task.id} - ${errorMessage}`);

        // Re-queue with backoff
        const backoffDelay = Math.min(1000 * Math.pow(2, task.retries - 1), 30000);
        setTimeout(() => {
          this.addToPriorityQueue(task);
        }, backoffDelay);

        return;
      }

      // Max retries exceeded
      const processingResult: ProcessingResult = {
        taskId: task.id,
        success: false,
        error: errorMessage,
        processingTime,
        retries: task.retries,
      };

      this.processingResults.push(processingResult);

      // Call error callback
      if (task.errorCallback) {
        try {
          task.errorCallback(error as Error);
        } catch (callbackError) {
          this.logger.error(`Error in error callback for task ${task.id}:`, callbackError);
        }
      }

      this.logger.error(`Task failed permanently: ${task.id} - ${errorMessage}`);
    }
  }

  /**
   * Starts the periodic metrics collection and monitoring routine.
   * Collects queue metrics and performs adaptive scaling every 30 seconds.
   */
  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 30000); // Every 30 seconds
  }

  /**
   * Updates metrics and performs adaptive scaling based on current system load.
   * Logs warnings for concerning performance indicators and adjusts worker count.
   */
  private updateMetrics() {
    const metrics = this.getQueueMetrics();

    // Log warnings for concerning metrics
    if (metrics.queueLength > 1000) {
      this.logger.warn(`Large task queue: ${metrics.queueLength} tasks waiting`);
    }

    if (metrics.errorRate > 10) {
      this.logger.warn(`High task error rate: ${metrics.errorRate.toFixed(1)}%`);
    }

    if (metrics.averageProcessingTime > 5000) {
      this.logger.warn(`Slow task processing: ${metrics.averageProcessingTime.toFixed(0)}ms average`);
    }

    // Adaptive worker scaling based on queue length
    this.adaptiveWorkerScaling(metrics);
  }

  /**
   * Adaptively scales the number of worker threads based on queue length and system load.
   * Increases workers when queue grows and decreases when load is light.
   *
   * @param metrics - Current queue metrics used for scaling decisions
   */
  private adaptiveWorkerScaling(metrics: QueueMetrics) {
    const targetWorkers = Math.min(
      Math.max(
        Math.ceil(metrics.queueLength / 10), // 1 worker per 10 queued tasks
        1 // Minimum 1 worker
      ),
      this.maxWorkers
    );

    if (targetWorkers !== this.maxWorkers) {
      this.maxWorkers = targetWorkers;
      this.logger.debug(`Adjusted max workers to ${this.maxWorkers} based on queue length`);
    }
  }

  /**
   * Cleans up old processing results to prevent memory leaks.
   * Removes results older than 1 hour to maintain reasonable memory usage.
   */
  private cleanupOldResults() {
    const cutoffTime = Date.now() - 3600000; // Keep last hour
    this.processingResults = this.processingResults.filter(
      result => result.processingTime > cutoffTime
    );
  }

  /**
   * Generates a unique task identifier using timestamp and random string.
   * Format: task_{timestamp}_{random_suffix}
   *
   * @returns Unique task ID string
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Retrieves comprehensive processing statistics for monitoring and analysis.
   * Includes success rates, processing times, and current queue metrics.
   *
   * @returns Detailed statistics about task processing performance
   */
  getProcessingStatistics() {
    const now = Date.now();
    const lastHour = now - 3600000;

    const recentResults = this.processingResults.filter(
      result => result.processingTime > lastHour
    );

    const successful = recentResults.filter(r => r.success);
    const failed = recentResults.filter(r => !r.success);

    return {
      totalProcessed: recentResults.length,
      successful: successful.length,
      failed: failed.length,
      successRate: recentResults.length > 0 ? (successful.length / recentResults.length) * 100 : 0,
      averageProcessingTime: successful.length > 0
        ? successful.reduce((sum, r) => sum + r.processingTime, 0) / successful.length
        : 0,
      queueMetrics: this.getQueueMetrics(),
    };
  }

  /**
   * Pauses the async processing system for maintenance or emergency situations.
   * No new tasks will be processed until resumeProcessing() is called.
   */
  pauseProcessing() {
    this.isProcessing = false;
    this.logger.log('Async processing paused');
  }

  /**
   * Resumes async processing after it has been paused.
   * Allows the system to continue processing queued tasks.
   */
  resumeProcessing() {
    this.isProcessing = true;
    this.logger.log('Async processing resumed');
  }
}
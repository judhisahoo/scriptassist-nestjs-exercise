import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

export interface AsyncTask {
  id: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  data: any;
  createdAt: number;
  retries: number;
  maxRetries: number;
  timeout?: number;
  callback?: (result: any) => void;
  errorCallback?: (error: Error) => void;
}

export interface ProcessingResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: string;
  processingTime: number;
  retries: number;
}

export interface QueueMetrics {
  queueLength: number;
  processingRate: number;
  averageProcessingTime: number;
  errorRate: number;
  activeWorkers: number;
  queuedTasks: number;
}

@Injectable()
export class AsyncProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsyncProcessorService.name);
  private taskQueue: AsyncTask[] = [];
  private processingResults: ProcessingResult[] = [];
  private activeWorkers = 0;
  private maxWorkers: number;
  private processingInterval: NodeJS.Timeout;
  private metricsInterval: NodeJS.Timeout;
  private isProcessing = true;

  // Priority queues
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

  async onModuleInit() {
    this.startProcessing();
    this.startMetricsCollection();
    this.logger.log(`Async processor initialized with ${this.maxWorkers} max workers`);
  }

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
   * Submit a task for async processing
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
    const {
      priority = 'normal',
      maxRetries = 3,
      timeout,
      callback,
      errorCallback,
    } = options;

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
   * Submit multiple tasks in batch
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
   * Get task status
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
   * Cancel a queued task
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
   * Get queue metrics
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
   * Register task processor for a specific task type
   */
  registerProcessor(taskType: string, processor: (data: any) => Promise<any>) {
    // Store processor functions (simplified - would use a Map in real implementation)
    (this as any)[`process_${taskType}`] = processor;
    this.logger.log(`Processor registered for task type: ${taskType}`);
  }

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

  private startProcessing() {
    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing) return;

      await this.processNextBatch();
    }, 100); // Process every 100ms
  }

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

  private getNextTask(): AsyncTask | null {
    // Priority order: critical > high > normal > low
    return this.criticalQueue.shift() ||
           this.highQueue.shift() ||
           this.normalQueue.shift() ||
           this.lowQueue.shift() ||
           null;
  }

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

  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 30000); // Every 30 seconds
  }

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
   * Clean up old processing results
   */
  private cleanupOldResults() {
    const cutoffTime = Date.now() - 3600000; // Keep last hour
    this.processingResults = this.processingResults.filter(
      result => result.processingTime > cutoffTime
    );
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get processing statistics
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
   * Pause processing (for maintenance)
   */
  pauseProcessing() {
    this.isProcessing = false;
    this.logger.log('Async processing paused');
  }

  /**
   * Resume processing
   */
  resumeProcessing() {
    this.isProcessing = true;
    this.logger.log('Async processing resumed');
  }
}
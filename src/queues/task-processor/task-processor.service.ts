import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TaskApplicationService } from '../../modules/tasks/application/task.application.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

/**
 * Interface defining the structure of job processing results
 * Used for consistent response handling across all job types
 */
export interface JobResult {
  /** Indicates whether the job completed successfully */
  success: boolean;
  /** Error message if the job failed */
  error?: string;
  /** Additional data returned from successful job processing */
  data?: any;
}

/**
 * BullMQ processor service for asynchronous task processing
 *
 * This service extends WorkerHost to handle background job processing for
 * task-related operations. It implements a queue-based architecture for
 * scalable and reliable task processing, including status updates and
 * overdue task notifications.
 *
 * Key features:
 * - Asynchronous job processing with BullMQ
 * - Automatic retry logic with exponential backoff
 * - Comprehensive error handling and logging
 * - Correlation ID tracking for request tracing
 * - Multiple job type handling (status updates, overdue notifications)
 *
 * @remarks
 * - Processes jobs from the 'task-processing' queue
 * - Implements OnModuleInit/OnModuleDestroy for lifecycle management
 * - Uses correlation IDs for distributed tracing
 * - Handles transient failures with retry logic
 */
@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  /** Logger instance for job processing operations and debugging */
  private readonly logger = new Logger(TaskProcessorService.name);

  /** Maximum number of retry attempts for failed jobs */
  private readonly maxRetries = 3;

  /** Base delay in milliseconds between retry attempts */
  private readonly retryDelay = 1000; // 1 second

  /**
   * Constructor for TaskProcessorService
   * @param taskService - Application service for task domain operations
   */
  constructor(private readonly taskService: TaskApplicationService) {
    super();
  }

  /**
   * Lifecycle hook called when the module is initialized
   * Used for startup logging and any initialization tasks
   */
  onModuleInit(): void {
    this.logger.log('Task processor service initialized and ready to process jobs');
  }

  /**
   * Lifecycle hook called when the module is being destroyed
   * Used for cleanup logging and graceful shutdown
   */
  onModuleDestroy(): void {
    this.logger.log('Task processor service shutting down');
  }

  /**
   * Main job processing method called by BullMQ for each queued job
   *
   * This method implements the core job processing logic with:
   * - Correlation ID generation for distributed tracing
   * - Job type routing to appropriate handlers
   * - Comprehensive error handling and retry logic
   * - Structured logging for monitoring and debugging
   *
   * @param job - BullMQ job object containing job data and metadata
   * @returns Promise resolving to JobResult with success status and data
   */
  async process(job: Job): Promise<JobResult> {
    // Generate unique correlation ID for request tracing across distributed systems
    const correlationId = `job_${job.id}_${Date.now()}`;
    this.logger.debug(`[${correlationId}] Processing job ${job.id} of type ${job.name}`);

    try {
      // Route job to appropriate handler based on job name
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job, correlationId);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job, correlationId);
        default:
          // Log unknown job types for monitoring and debugging
          this.logger.warn(`[${correlationId}] Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      // Extract error message safely
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log error with full context for debugging
      this.logger.error(
        `[${correlationId}] Error processing job ${job.id}: ${errorMessage}`,
        (error as Error).stack,
      );

      // Implement retry logic for transient failures
      if (job.attemptsMade < this.maxRetries) {
        const attemptNumber = job.attemptsMade + 1;
        this.logger.warn(
          `[${correlationId}] Retrying job ${job.id} (attempt ${attemptNumber}/${this.maxRetries})`,
        );

        // Exponential backoff delay to prevent overwhelming the system
        await this.delay(this.retryDelay * job.attemptsMade);

        // Re-throw to let BullMQ handle the retry mechanism
        throw error;
      } else {
        // Job failed after all retry attempts
        this.logger.error(
          `[${correlationId}] Job ${job.id} failed permanently after ${this.maxRetries} attempts`,
        );
        return { success: false, error: errorMessage };
      }
    }
  }

  /**
   * Handles task status update jobs from the queue
   *
   * This method processes asynchronous task status updates, typically triggered
   * by business events or scheduled operations. It validates input data,
   * updates the task status through the application service, and returns
   * the updated task information.
   *
   * @param job - BullMQ job containing taskId and new status
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to JobResult with update confirmation
   */
  private async handleStatusUpdate(job: Job, correlationId: string): Promise<JobResult> {
    // Extract job data with destructuring
    const { taskId, status } = job.data;

    // Validate required input data
    if (!taskId || !status) {
      const error = 'Missing required data: taskId and status are required';
      this.logger.error(`[${correlationId}] ${error}`);
      return { success: false, error };
    }

    try {
      // Validate that the status is a valid enum value
      if (!Object.values(TaskStatus).includes(status)) {
        const error = `Invalid status value: ${status}. Must be one of: ${Object.values(TaskStatus).join(', ')}`;
        this.logger.error(`[${correlationId}] ${error}`);
        return { success: false, error };
      }

      this.logger.debug(`[${correlationId}] Updating task ${taskId} to status ${status}`);

      // Update task status through application service
      await this.taskService.updateTask(taskId, { status });

      // Retrieve updated task to confirm the change
      const updatedTask = await this.taskService.getTaskById(taskId);

      if (!updatedTask) {
        const error = 'Task not found after update - possible race condition or deletion';
        this.logger.error(`[${correlationId}] ${error}`);
        throw new Error(error);
      }

      this.logger.debug(`[${correlationId}] Successfully updated task ${taskId} status to ${updatedTask.status}`);

      // Return success result with updated task information
      return {
        success: true,
        data: {
          taskId: updatedTask.id,
          newStatus: updatedTask.status,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${correlationId}] Failed to update task status: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Handles overdue task notification jobs from the queue
   *
   * This method processes tasks that have been identified as overdue by the
   * scheduled task service. It updates the task status to OVERDUE and prepares
   * notification data for alerting stakeholders about missed deadlines.
   *
   * Business Logic:
   * - Updates task status to OVERDUE to trigger UI changes and reports
   * - Validates task existence after update
   * - Returns notification-ready data for email/SMS alerts
   *
   * @param job - BullMQ job containing taskId, dueDate, and title
   * @param correlationId - Unique identifier for request tracing
   * @returns Promise resolving to JobResult with overdue task data
   */
  private async handleOverdueTasks(job: Job, correlationId: string): Promise<JobResult> {
    // Extract job data with destructuring
    const { taskId, dueDate, title } = job.data;

    // Validate required input data
    if (!taskId) {
      const error = 'Missing required data: taskId is required for overdue task processing';
      this.logger.error(`[${correlationId}] ${error}`);
      return { success: false, error };
    }

    try {
      this.logger.debug(`[${correlationId}] Processing overdue task ${taskId} (${title}) with due date ${dueDate}`);

      // Update the task status to OVERDUE to reflect its current state
      await this.taskService.updateTask(taskId, { status: TaskStatus.OVERDUE });

      // Retrieve updated task to confirm the change and get current data
      const updatedTask = await this.taskService.getTaskById(taskId);

      if (!updatedTask) {
        const error = 'Task not found after overdue status update - possible concurrent deletion';
        this.logger.error(`[${correlationId}] ${error}`);
        throw new Error(error);
      }

      this.logger.debug(`[${correlationId}] Successfully marked task ${taskId} as overdue`);

      // Return success result with data for notification systems
      return {
        success: true,
        data: {
          taskId: updatedTask.id,
          newStatus: updatedTask.status,
          title: updatedTask.title,
          // Include additional data that notification systems might need
          wasDueDate: dueDate,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${correlationId}] Failed to process overdue task ${taskId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Utility method to create delays for retry logic
   *
   * This method provides a Promise-based delay mechanism used in the
   * retry logic to implement exponential backoff. It prevents the
   * system from being overwhelmed during transient failure scenarios.
   *
   * @param ms - Delay duration in milliseconds
   * @returns Promise that resolves after the specified delay
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

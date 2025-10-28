import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TaskApplicationService } from '../../modules/tasks/application/task.application.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

export interface JobResult {
  success: boolean;
  error?: string;
  data?: any;
}

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskProcessorService.name);
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor(private readonly taskService: TaskApplicationService) {
    super();
  }

  onModuleInit() {
    this.logger.log('Task processor initialized');
  }

  onModuleDestroy() {
    this.logger.log('Task processor shutting down');
  }

  async process(job: Job): Promise<JobResult> {
    const correlationId = `job_${job.id}_${Date.now()}`;
    this.logger.debug(`[${correlationId}] Processing job ${job.id} of type ${job.name}`);

    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job, correlationId);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job, correlationId);
        default:
          this.logger.warn(`[${correlationId}] Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[${correlationId}] Error processing job ${job.id}: ${errorMessage}`,
        (error as Error).stack,
      );

      // Implement retry logic
      if (job.attemptsMade < this.maxRetries) {
        this.logger.warn(
          `[${correlationId}] Retrying job ${job.id} (attempt ${job.attemptsMade + 1}/${this.maxRetries})`,
        );
        await this.delay(this.retryDelay * job.attemptsMade);
        throw error; // Let BullMQ handle the retry
      } else {
        this.logger.error(
          `[${correlationId}] Job ${job.id} failed after ${this.maxRetries} attempts`,
        );
        return { success: false, error: errorMessage };
      }
    }
  }

  private async handleStatusUpdate(job: Job, correlationId: string): Promise<JobResult> {
    const { taskId, status } = job.data;

    if (!taskId || !status) {
      const error = 'Missing required data: taskId and status are required';
      this.logger.error(`[${correlationId}] ${error}`);
      return { success: false, error };
    }

    try {
      // Validate status enum
      if (!Object.values(TaskStatus).includes(status)) {
        const error = `Invalid status: ${status}`;
        this.logger.error(`[${correlationId}] ${error}`);
        return { success: false, error };
      }

      this.logger.debug(`[${correlationId}] Updating task ${taskId} to status ${status}`);

      await this.taskService.updateTask(taskId, { status });
      const updatedTask = await this.taskService.getTaskById(taskId);

      if (!updatedTask) {
        const error = 'Task not found after update';
        this.logger.error(`[${correlationId}] ${error}`);
        throw new Error(error);
      }

      this.logger.debug(`[${correlationId}] Successfully updated task ${taskId}`);
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

  private async handleOverdueTasks(job: Job, correlationId: string): Promise<JobResult> {
    this.logger.debug(`[${correlationId}] Processing overdue tasks notification`);

    try {
      const result = await this.taskService.getTasks(undefined, undefined, 1, 100);
      const now = new Date();
      const overdueTasks = result.items.filter(
        task =>
          task.dueDate && new Date(task.dueDate) < now && task.status !== TaskStatus.COMPLETED,
      );

      this.logger.debug(`[${correlationId}] Found ${overdueTasks.length} overdue tasks`);

      // Process tasks in batches to avoid overwhelming the system
      const batchSize = 10;
      let processedCount = 0;

      for (let i = 0; i < overdueTasks.length; i += batchSize) {
        const batch = overdueTasks.slice(i, i + batchSize);
        await Promise.all(
          batch.map(task =>
            this.taskService.updateTask(task.id, { status: TaskStatus.OVERDUE }).catch(error => {
              this.logger.error(
                `[${correlationId}] Failed to update overdue task ${task.id}: ${(error as Error).message}`,
              );
              // Continue processing other tasks even if one fails
            }),
          ),
        );
        processedCount += batch.length;

        // Small delay between batches to prevent overwhelming
        if (i + batchSize < overdueTasks.length) {
          await this.delay(100);
        }
      }

      this.logger.debug(`[${correlationId}] Processed ${processedCount} overdue tasks`);
      return {
        success: true,
        data: {
          message: 'Overdue tasks processed',
          processedCount,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[${correlationId}] Failed to process overdue tasks: ${errorMessage}`);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

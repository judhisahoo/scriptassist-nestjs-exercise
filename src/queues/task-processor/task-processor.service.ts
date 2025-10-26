import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TaskApplicationService } from '../../modules/tasks/application/task.application.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  constructor(private readonly taskService: TaskApplicationService) {
    super();
  }

  // Inefficient implementation:
  // - No proper job batching
  // - No error handling strategy
  // - No retries for failed jobs
  // - No concurrency control
  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
    
    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      // Basic error logging without proper handling or retries
      this.logger.error(`Error processing job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Simply rethrows the error without any retry strategy
    }
  }

  private async handleStatusUpdate(job: Job) {
    const { taskId, status } = job.data;
    
    if (!taskId || !status) {
      return { success: false, error: 'Missing required data' };
    }
    
    // Inefficient: No validation of status values
    // No transaction handling
    // No retry mechanism
    await this.taskService.updateTask(taskId, { status });
    const updatedTask = await this.taskService.getTaskById(taskId);
    
    if (!updatedTask) {
      throw new Error('Task not found after update');
    }

    return {
      success: true,
      taskId: updatedTask.id,
      newStatus: updatedTask.status
    };
  }

  private async handleOverdueTasks(_job: Job) {
    this.logger.debug('Processing overdue tasks notification');
    
    // Query for overdue tasks using the application service
    const result = await this.taskService.getTasks(undefined, undefined, 1, 100);
    const now = new Date();
    const overdueTasks = result.items.filter(task => 
      task.dueDate && new Date(task.dueDate) < now && task.status !== TaskStatus.COMPLETED
    );
    
    // Process tasks sequentially - could be optimized with batch processing
    for (const task of overdueTasks) {
      await this.taskService.updateTask(task.id, { status: TaskStatus.OVERDUE });
    }
    
    return { 
      success: true, 
      message: 'Overdue tasks processed',
      processedCount: overdueTasks.length 
    };
  }
} 
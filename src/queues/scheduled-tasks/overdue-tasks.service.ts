import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

/**
 * Service for handling scheduled tasks related to overdue task management
 *
 * This service implements automated background processing for task management,
 * specifically focusing on identifying and processing tasks that have passed
 * their due dates. It uses NestJS scheduling decorators to run periodic checks
 * and integrates with BullMQ for asynchronous task processing.
 *
 * Key responsibilities:
 * - Periodic scanning of tasks for overdue status
 * - Queue-based processing of overdue tasks for notifications
 * - Automated workflow triggers for overdue task management
 * - Logging and monitoring of scheduled task execution
 *
 * @remarks
 * - Uses @nestjs/schedule for cron job scheduling
 * - Integrates with BullMQ for scalable task processing
 * - Implements proper error handling and logging
 * - Designed for high availability and fault tolerance
 */
@Injectable()
export class OverdueTasksService {
  /** Logger instance for service operations and debugging */
  private readonly logger = new Logger(OverdueTasksService.name);

  /**
   * Constructor for OverdueTasksService
   * @param taskQueue - BullMQ queue for asynchronous task processing
   * @param tasksRepository - TypeORM repository for task data access
   */
  constructor(
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  /**
   * Scheduled method to check for and process overdue tasks
   *
   * This method runs every hour as defined by the @Cron decorator.
   * It identifies tasks that are past their due date and still in PENDING status,
   * then queues them for notification processing. This enables automated
   * alerts and escalations for overdue work items.
   *
   * Business Logic:
   * - Only considers tasks with dueDate < current time
   * - Only processes tasks in PENDING status (not IN_PROGRESS or COMPLETED)
   * - Queues tasks for asynchronous notification processing
   * - Logs all operations for monitoring and debugging
   *
   * @cron Runs every hour using CronExpression.EVERY_HOUR
   * @returns Promise that resolves when overdue task processing is complete
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks(): Promise<void> {
    this.logger.debug('Starting scheduled check for overdue tasks...');

    try {
      // Get current timestamp for comparison
      const now = new Date();

      // Query for tasks that are overdue and still pending
      // Uses TypeORM LessThan operator for efficient date comparison
      const overdueTasks = await this.tasksRepository.find({
        where: {
          dueDate: LessThan(now), // Tasks with dueDate before current time
          status: TaskStatus.PENDING, // Only consider pending tasks
        },
      });

      this.logger.log(`Found ${overdueTasks.length} overdue tasks requiring attention`);

      // Process overdue tasks if any were found
      if (overdueTasks.length > 0) {
        // Create queue jobs for each overdue task
        // Each job contains minimal data needed for notification processing
        const jobs = overdueTasks.map(task =>
          this.taskQueue.add('overdue-tasks-notification', {
            taskId: task.id,
            dueDate: task.dueDate,
            title: task.title,
          })
        );

        // Wait for all jobs to be added to the queue
        await Promise.all(jobs);

        this.logger.log(`Successfully queued ${overdueTasks.length} overdue tasks for notification processing`);
      }

      this.logger.debug('Completed scheduled overdue tasks check');
    } catch (error) {
      // Log error with full context for debugging and monitoring
      this.logger.error(
        `Critical error during overdue tasks check: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Note: Error is caught but not re-thrown to prevent cron job failure
      // Consider implementing retry logic or alerting mechanisms
    }
  }
}

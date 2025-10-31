import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { OverdueTasksService } from './overdue-tasks.service';
import { TasksModule } from '../../modules/tasks/tasks.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';

/**
 * Module for scheduled task processing and automation
 *
 * This module provides infrastructure for background task processing and
 * scheduled operations in the task management system. It integrates
 * multiple NestJS modules to enable cron-based scheduling and queue-based
 * asynchronous processing.
 *
 * Key features:
 * - Cron job scheduling using @nestjs/schedule
 * - Asynchronous task processing with BullMQ
 * - Database access for scheduled operations
 * - Integration with task management domain logic
 *
 * Module responsibilities:
 * - Overdue task detection and notification queuing
 * - Automated workflow triggers and escalations
 * - Background processing of time-sensitive operations
 * - Scheduled maintenance and cleanup tasks
 *
 * @remarks
 * - Uses ScheduleModule.forRoot() to enable global scheduling
 * - Registers BullMQ queue for task processing integration
 * - Provides TypeORM access to Task entities for scheduled operations
 * - Exports services for use in other modules if needed
 */
@Module({
  imports: [
    // Enable cron job scheduling globally
    ScheduleModule.forRoot(),

    // Register BullMQ queue for asynchronous task processing
    BullModule.registerQueue({
      name: 'task-processing',
    }),

    // Provide TypeORM repository access to Task entities
    TypeOrmModule.forFeature([Task]),

    // Import TasksModule for domain logic access
    TasksModule,
  ],
  providers: [
    // Register the overdue tasks service for cron job execution
    OverdueTasksService,
  ],
  exports: [
    // Export service for potential use by other modules
    OverdueTasksService,
  ],
})
export class ScheduledTasksModule {}

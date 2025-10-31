import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TaskProcessorService } from './task-processor.service';
import { TasksModule } from '../../modules/tasks/tasks.module';

/**
 * Module for asynchronous task processing using BullMQ
 *
 * This module provides the infrastructure for background job processing
 * in the task management system. It integrates BullMQ for reliable,
 * scalable queue-based processing of task-related operations.
 *
 * Key features:
 * - BullMQ queue registration for task processing
 * - Integration with task domain logic
 * - Asynchronous job handling for scalability
 * - Background processing of status updates and notifications
 *
 * Module responsibilities:
 * - Register the 'task-processing' queue with BullMQ
 * - Provide TaskProcessorService for job handling
 * - Enable integration with scheduled task operations
 * - Support for horizontal scaling through queue distribution
 *
 * @remarks
 * - Uses BullMQ for Redis-based queue management
 * - Processes jobs asynchronously to improve API response times
 * - Enables decoupling of immediate responses from background processing
 * - Supports job retries, prioritization, and monitoring
 */
@Module({
  imports: [
    // Register BullMQ queue for task processing operations
    BullModule.registerQueue({
      name: 'task-processing',
    }),

    // Import TasksModule to access task domain logic and services
    TasksModule,
  ],
  providers: [
    // Register the task processor service as a job handler
    TaskProcessorService,
  ],
  exports: [
    // Export service for potential monitoring or testing access
    TaskProcessorService,
  ],
})
export class TaskProcessorModule {}

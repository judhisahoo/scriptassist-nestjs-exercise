import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CqrsModule } from '@nestjs/cqrs';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { TaskRepository } from './infrastructure/task.repository';
import { TaskApplicationService } from './application/task.application.service';
import {
  CreateTaskHandler,
  UpdateTaskHandler,
  CompleteTaskHandler,
} from './application/commands/task.handlers';
import {
  GetTaskByIdHandler,
  GetTasksHandler,
  GetTasksByAssigneeHandler,
} from './application/queries/task.handlers';

/**
 * CQRS Command Handlers for task operations
 * Handles create, update, and complete task commands
 */
const CommandHandlers = [CreateTaskHandler, UpdateTaskHandler, CompleteTaskHandler];

/**
 * CQRS Query Handlers for task retrieval operations
 * Handles queries for individual tasks, task lists, and assignee-specific tasks
 */
const QueryHandlers = [GetTaskByIdHandler, GetTasksHandler, GetTasksByAssigneeHandler];

/**
 * Tasks Module - Core module for task management functionality
 * Implements CQRS pattern with separate command and query handling
 * Provides task CRUD operations, filtering, and background processing
 */
@Module({
  imports: [
    CqrsModule, // Enables CQRS pattern with CommandBus and QueryBus
    TypeOrmModule.forFeature([Task]), // Registers Task entity with TypeORM
    BullModule.registerQueue({
      name: 'task-processing', // Queue for background task processing
    }),
  ],
  controllers: [TasksController], // HTTP API controllers
  providers: [
    TaskRepository, // Infrastructure layer data access
    TaskApplicationService, // Application layer business logic
    ...CommandHandlers, // CQRS command handlers
    ...QueryHandlers, // CQRS query handlers
  ],
  exports: [
    TaskApplicationService, // Export for use in other modules
    TaskRepository, // Export for potential cross-module data access
  ],
})
export class TasksModule {}

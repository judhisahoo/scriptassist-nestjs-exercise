import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CqrsModule } from '@nestjs/cqrs';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { TaskRepository } from './infrastructure/task.repository';
import { TaskApplicationService } from './application/task.application.service';
import { CreateTaskHandler, UpdateTaskHandler, CompleteTaskHandler } from './application/commands/task.handlers';
import { GetTaskByIdHandler, GetTasksHandler, GetTasksByAssigneeHandler } from './application/queries/task.handlers';

const CommandHandlers = [
  CreateTaskHandler,
  UpdateTaskHandler,
  CompleteTaskHandler,
];

const QueryHandlers = [
  GetTaskByIdHandler,
  GetTasksHandler,
  GetTasksByAssigneeHandler,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Task]),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
  ],
  controllers: [TasksController],
  providers: [
    TaskRepository,
    TaskApplicationService,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  exports: [TaskApplicationService, TaskRepository],
})
export class TasksModule {}
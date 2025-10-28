import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateTaskCommand, UpdateTaskCommand, CompleteTaskCommand } from './task.commands';
import { TaskRepository } from '../../infrastructure/task.repository';
import { TaskAggregate } from '../../domain/task.aggregate';
import { v4 as uuidv4 } from 'uuid';
import { TaskPriority } from '../../enums/task-priority.enum';
import { TaskStatus } from '../../enums/task-status.enum';
import { Logger } from '@nestjs/common';

@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand> {
  private readonly logger = new Logger(CreateTaskHandler.name);

  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(command: CreateTaskCommand): Promise<void> {
    try {
      const taskId = uuidv4();
      const task = new TaskAggregate(taskId);

      task.createTask(
        command.title,
        command.description,
        command.priority as TaskPriority,
        command.dueDate ? new Date(command.dueDate) : null,
        command.assigneeId,
      );

      await this.taskRepository.save(task);
      this.logger.log(`Task created successfully: ${taskId}`);
    } catch (error) {
      this.logger.error(
        `Failed to create task: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}

@CommandHandler(UpdateTaskCommand)
export class UpdateTaskHandler implements ICommandHandler<UpdateTaskCommand> {
  private readonly logger = new Logger(UpdateTaskHandler.name);

  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(command: UpdateTaskCommand): Promise<void> {
    try {
      const task = await this.taskRepository.findById(command.id);
      if (!task) {
        throw new Error('Task not found');
      }

      // Update the task with all fields including status
      const status = command.status
        ? TaskStatus[command.status as keyof typeof TaskStatus]
        : undefined;
      const priority = command.priority
        ? TaskPriority[command.priority as keyof typeof TaskPriority]
        : undefined;

      task.updateTask(
        command.title,
        command.description,
        status,
        priority,
        command.dueDate ? new Date(command.dueDate) : null,
      );

      await this.taskRepository.save(task);
      this.logger.log(`Task updated successfully: ${command.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to update task ${command.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}

@CommandHandler(CompleteTaskCommand)
export class CompleteTaskHandler implements ICommandHandler<CompleteTaskCommand> {
  private readonly logger = new Logger(CompleteTaskHandler.name);

  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(command: CompleteTaskCommand): Promise<void> {
    try {
      const task = await this.taskRepository.findById(command.id);
      if (!task) {
        throw new Error('Task not found');
      }

      task.completeTask();
      await this.taskRepository.save(task);
      this.logger.log(`Task completed successfully: ${command.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to complete task ${command.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}

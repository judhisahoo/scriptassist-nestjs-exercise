import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CreateTaskCommand,
  UpdateTaskCommand,
  CompleteTaskCommand,
} from './commands/task.commands';
import {
  GetTaskByIdQuery,
  GetTasksQuery,
  GetTasksByAssigneeQuery,
} from './queries/task.queries';
import { Task } from '../entities/task.entity';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { TaskStatus } from '../enums/task-status.enum';

@Injectable()
export class TaskApplicationService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async createTask(dto: CreateTaskDto): Promise<void> {
    const command = new CreateTaskCommand(
      dto.title,
      dto.description || '',
      dto.priority,
      dto.dueDate,
      dto.userId,
    );
    await this.commandBus.execute(command);
  }

  async updateTask(id: string, dto: UpdateTaskDto): Promise<void> {
    // Extract only the allowed fields for update
    const { priority, title, description, status, dueDate } = dto;
    const command = new UpdateTaskCommand(id, title, description, status, priority, dueDate);
    await this.commandBus.execute(command);
  }

  async completeTask(id: string): Promise<void> {
    const command = new CompleteTaskCommand(id);
    await this.commandBus.execute(command);
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.queryBus.execute(new GetTaskByIdQuery(id));
  }

  async getTasks(
    status?: TaskStatus,
    priority?: string,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ items: Task[]; total: number }> {
    return this.queryBus.execute(
      new GetTasksQuery(status, priority, page, limit, search),
    );
  }

  async getTasksByAssignee(
    assigneeId: string,
    status?: TaskStatus,
  ): Promise<Task[]> {
    return this.queryBus.execute(
      new GetTasksByAssigneeQuery(assigneeId, status),
    );
  }
}
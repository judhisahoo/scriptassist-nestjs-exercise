import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetTaskByIdQuery, GetTasksQuery, GetTasksByAssigneeQuery } from './task.queries';
import { TaskRepository } from '../../infrastructure/task.repository';
import { Task } from '../../entities/task.entity';

@QueryHandler(GetTaskByIdQuery)
export class GetTaskByIdHandler implements IQueryHandler<GetTaskByIdQuery> {
  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(query: GetTaskByIdQuery): Promise<Task | null> {
    const taskAggregate = await this.taskRepository.findById(query.id);
    if (!taskAggregate) return null;

    const task = new Task();
    task.id = taskAggregate.getId();
    task.title = taskAggregate.getTitle();
    task.description = taskAggregate.getDescription();
    task.status = taskAggregate.getStatus();
    task.priority = taskAggregate.getPriority();
    task.dueDate = taskAggregate.getDueDate();
    task.userId = taskAggregate.getAssigneeId(); // Map assigneeId to userId
    return task;
  }
}

@QueryHandler(GetTasksQuery)
export class GetTasksHandler implements IQueryHandler<GetTasksQuery> {
  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(query: GetTasksQuery): Promise<{ items: Task[]; total: number }> {
    return this.taskRepository.findTasks(
      query.status,
      query.priority,
      query.page,
      query.limit,
      query.search,
    );
  }
}

@QueryHandler(GetTasksByAssigneeQuery)
export class GetTasksByAssigneeHandler implements IQueryHandler<GetTasksByAssigneeQuery> {
  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(query: GetTasksByAssigneeQuery): Promise<Task[]> {
    return this.taskRepository.findByAssignee(query.userId, query.status);
  }
}
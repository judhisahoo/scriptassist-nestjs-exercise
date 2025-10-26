import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Task } from '../entities/task.entity';
import { TaskAggregate } from '../domain/task.aggregate';
import { ITaskRepository } from '../domain/task.repository.interface';

@Injectable()
export class TaskRepository implements ITaskRepository {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly dataSource: DataSource,
  ) {}

  async save(taskAggregate: TaskAggregate): Promise<void> {
    const task = this.mapAggregateToEntity(taskAggregate);
    await this.dataSource.transaction(async (entityManager) => {
      await entityManager.save(task);
    });
  }

  async findById(id: string): Promise<TaskAggregate | null> {
    // Use query builder to ensure we get fresh data
    const task = await this.taskRepository
      .createQueryBuilder('task')
      .where('task.id = :id', { id })
      .cache(false)  // Disable cache to always get fresh data
      .getOne();

    return task ? this.mapEntityToAggregate(task) : null;
  }

  async findTasks(
    status?: string,
    priority?: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<{ items: Task[]; total: number }> {
    const queryBuilder = this.taskRepository.createQueryBuilder('task')
      .leftJoinAndSelect('task.user', 'user');

    if (status) {
      queryBuilder.andWhere('task.status = :status', { status });
    }

    if (priority) {
      queryBuilder.andWhere('task.priority = :priority', { priority });
    }

    if (search) {
      queryBuilder.andWhere('(task.title ILIKE :search OR task.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total };
  }

  async findByAssignee(userId: string | null, status?: string): Promise<Task[]> {
    const queryBuilder = this.taskRepository.createQueryBuilder('task');

    if (userId) {
      queryBuilder.where('task.userId = :userId', { userId });
    } else {
      queryBuilder.where('task.userId IS NULL');
    }

    if (status) {
      queryBuilder.andWhere('task.status = :status', { status });
    }

    return queryBuilder.getMany();
  }

  async delete(id: string): Promise<void> {
    await this.dataSource.transaction(async (entityManager) => {
      await entityManager.delete(Task, id);
    });
  }

  private mapAggregateToEntity(taskAggregate: TaskAggregate): Task {
    const task = new Task();
    task.id = taskAggregate.getId();
    task.title = taskAggregate.getTitle();
    task.description = taskAggregate.getDescription();
    task.status = taskAggregate.getStatus();
    task.priority = taskAggregate.getPriority();
    task.dueDate = taskAggregate.getDueDate();
    task.userId = taskAggregate.getAssigneeId(); // Changed from assigneeId to userId
    return task;
  }

  private mapEntityToAggregate(task: Task): TaskAggregate {
    const taskAggregate = new TaskAggregate(task.id);
    taskAggregate.createTask(
      task.title,
      task.description,
      task.priority,
      task.dueDate,
      task.userId, // Use userId instead of assigneeId
    );
    // Set the current status after creation
    taskAggregate.updateTask(
      undefined,
      undefined,
      task.status,
      undefined,
      undefined
    );
    return taskAggregate;
  }
}
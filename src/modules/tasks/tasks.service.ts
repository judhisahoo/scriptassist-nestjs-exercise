import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Task } from './entities/task.entity';
import { User } from '../users/entities/user.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';

interface TaskQueryParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    private dataSource: DataSource,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    // Use transaction to ensure task creation and queue operation are atomic
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    try {
      const task = this.tasksRepository.create(createTaskDto);
      const savedTask = await queryRunner.manager.save(Task, task);
      
      await this.taskQueue.add('task-status-update', {
        taskId: savedTask.id,
        status: savedTask.status,
      });

      await queryRunner.commitTransaction();
      return savedTask;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to create task: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(params: TaskQueryParams = {}): Promise<{
    items: Task[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { status, priority, page = 1, limit = 10, search } = params;
    
    // Build optimized query
    const queryBuilder = this.tasksRepository
      .createQueryBuilder('task')
      .select([
        'task.id',
        'task.title',
        'task.description',
        'task.status',
        'task.priority',
        'task.dueDate',
        'task.createdAt',
        'task.updatedAt',
        'task.userId',
      ])
      .orderBy('task.createdAt', 'DESC');
    
    // Apply filters
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

    // Calculate pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Execute main query
    const [tasks, total] = await queryBuilder.getManyAndCount();

    // Efficiently load users in a single query if we have tasks
    if (tasks.length > 0) {
      const userIds = tasks.map(task => task.userId).filter(Boolean);
      if (userIds.length > 0) {
        const users = await this.dataSource
          .getRepository(User)
          .createQueryBuilder('user')
          .where('user.id IN (:...ids)', { ids: [...new Set(userIds)] })
          .getMany();

        const userMap = new Map(users.map(user => [user.id, user]));
        tasks.forEach(task => {
          const user = task.userId ? userMap.get(task.userId) : undefined;
          if (user) {
            task.user = user;
          }
        });
      }
    }

    return {
      items: tasks,
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<Task> {
    // Single query with relation
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    // Use query builder for efficient single-query update
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get current status efficiently
      const currentTask = await this.tasksRepository.findOne({
        where: { id },
        select: ['status'],
      });

      if (!currentTask) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      // Update in single query and return updated entity
      await queryRunner.manager
        .createQueryBuilder()
        .update(Task)
        .set(updateTaskDto)
        .where('id = :id', { id })
        .returning('*')
        .execute();

      // Enqueue status update if changed
      if (updateTaskDto.status && currentTask.status !== updateTaskDto.status) {
        await this.taskQueue.add('task-status-update', {
          taskId: id,
          status: updateTaskDto.status,
        });
      }

      await queryRunner.commitTransaction();
      
      // Load relations for return value
      const finalTask = await this.tasksRepository.findOne({
        where: { id },
        relations: ['user'],
      });
      
      if (!finalTask) {
        throw new NotFoundException(`Task with ID ${id} not found after update`);
      }
      return finalTask;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to update task ${id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(id: string): Promise<void> {
    // Single query delete with existence check
    const result = await this.tasksRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.findAll({ status, limit: 100 }).then(result => result.items);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    // Single query update with RETURNING
    const result = await this.tasksRepository
      .createQueryBuilder()
      .update(Task)
      .set({ status })
      .where('id = :id', { id })
      .returning('*')
      .execute();

    const updatedTask = result.raw?.[0];
    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return updatedTask;
  }

  // Bulk operations
  async bulkUpdateStatus(ids: string[], status: TaskStatus): Promise<{ updated: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get current statuses in a single query
      const currentTasks = await queryRunner.manager
        .createQueryBuilder(Task, 'task')
        .select(['task.id', 'task.status'])
        .whereInIds(ids)
        .getMany();

      // Update all tasks in single query
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(Task)
        .set({ status })
        .whereInIds(ids)
        .execute();

      // Enqueue status updates only for tasks that actually changed status
      const affected = result.affected ?? 0;
      if (affected > 0) {
        const statusChangedIds = currentTasks
          .filter(task => task.status !== status)
          .map(task => task.id);

        if (statusChangedIds.length > 0) {
          const jobs = statusChangedIds.map(id => ({
            name: 'task-status-update',
            data: { taskId: id, status },
          }));
          
          await this.taskQueue.addBulk(jobs);
        }
      }

      await queryRunner.commitTransaction();
      return { updated: affected };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to bulk update tasks: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    const result = await this.tasksRepository
      .createQueryBuilder()
      .delete()
      .whereInIds(ids)
      .execute();

    return { deleted: result.affected || 0 };
  }

  async getTaskStats(): Promise<{
    total: number;
    byStatus: Record<TaskStatus, number>;
    overdueTasks: number;
  }> {
    // Efficient single-query stats using SQL aggregation
    const stats = await this.tasksRepository
      .createQueryBuilder('task')
      .select([
        'COUNT(*) as total',
        `SUM(CASE WHEN status = '${TaskStatus.PENDING}' THEN 1 ELSE 0 END) as pending`,
        `SUM(CASE WHEN status = '${TaskStatus.IN_PROGRESS}' THEN 1 ELSE 0 END) as inProgress`,
        `SUM(CASE WHEN status = '${TaskStatus.COMPLETED}' THEN 1 ELSE 0 END) as completed`,
        `SUM(CASE WHEN status = '${TaskStatus.OVERDUE}' THEN 1 ELSE 0 END) as overdue`,
        `SUM(CASE WHEN due_date < NOW() AND status != '${TaskStatus.COMPLETED}' THEN 1 ELSE 0 END) as overdueCount`,
      ])
      .getRawOne();

    return {
      total: parseInt(stats?.total || '0'),
      byStatus: {
        [TaskStatus.PENDING]: parseInt(stats?.pending || '0'),
        [TaskStatus.IN_PROGRESS]: parseInt(stats?.inProgress || '0'),
        [TaskStatus.COMPLETED]: parseInt(stats?.completed || '0'),
        [TaskStatus.OVERDUE]: parseInt(stats?.overdue || '0'),
      },
      overdueTasks: parseInt(stats?.overdueCount || '0'),
    };
  }
}

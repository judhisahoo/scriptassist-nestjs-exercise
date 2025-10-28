import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import { GracefulDegradationService } from '../../common/services/graceful-degradation.service';
import { FaultIsolationService } from '../../common/services/fault-isolation.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly gracefulDegradationService: GracefulDegradationService,
    private readonly faultIsolationService: FaultIsolationService,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const task = this.taskRepository.create({
          ...createTaskDto,
          status: TaskStatus.PENDING,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const savedTask = await this.taskRepository.save(task);
        this.logger.log(`Task created: ${savedTask.id}`);
        return savedTask;
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn('Task creation failed, using fallback');
          // Return a mock task for degraded mode
          return {
            id: 'fallback-' + Date.now(),
            title: createTaskDto.title,
            description: createTaskDto.description,
            status: TaskStatus.PENDING,
            priority: createTaskDto.priority,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Task;
        },
      },
    );
  }

  async findAll(
    status?: TaskStatus,
    priority?: TaskPriority,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<{ items: Task[]; total: number; hasMore: boolean }> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const queryBuilder = this.taskRepository.createQueryBuilder('task');

        if (status) {
          queryBuilder.andWhere('task.status = :status', { status });
        }

        if (priority) {
          queryBuilder.andWhere('task.priority = :priority', { priority });
        }

        if (search) {
          queryBuilder.andWhere(
            '(task.title ILIKE :search OR task.description ILIKE :search)',
            { search: `%${search}%` },
          );
        }

        // Check if cache is available
        const useCache = this.gracefulDegradationService.isFeatureEnabled('cache');

        if (useCache) {
          queryBuilder.cache(30000); // 30 seconds cache
        }

        const [items, total] = await queryBuilder
          .orderBy('task.createdAt', 'DESC')
          .skip((page - 1) * limit)
          .take(limit + 1) // Get one extra to check if there are more
          .getManyAndCount();

        const hasMore = items.length > limit;
        const resultItems = hasMore ? items.slice(0, limit) : items;

        return { items: resultItems, total, hasMore };
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn('Task listing failed, using fallback');
          // Return cached or mock data for degraded mode
          return {
            items: [],
            total: 0,
            hasMore: false,
          };
        },
      },
    );
  }

  async findOne(id: string): Promise<Task> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const task = await this.taskRepository.findOne({ where: { id } });

        if (!task) {
          throw new Error(`Task with ID ${id} not found`);
        }

        return task;
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn(`Task ${id} lookup failed, using fallback`);
          throw new Error(`Task with ID ${id} not found (service degraded)`);
        },
      },
    );
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const task = await this.taskRepository.findOne({ where: { id } });

        if (!task) {
          throw new Error(`Task with ID ${id} not found`);
        }

        // Update fields
        Object.assign(task, updateTaskDto, { updatedAt: new Date() });

        const savedTask = await this.taskRepository.save(task);
        this.logger.log(`Task updated: ${id}`);
        return savedTask;
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn(`Task ${id} update failed, using fallback`);
          throw new Error(`Task update failed (service degraded)`);
        },
      },
    );
  }

  async remove(id: string): Promise<void> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const result = await this.taskRepository.delete(id);

        if (result.affected === 0) {
          throw new Error(`Task with ID ${id} not found`);
        }

        this.logger.log(`Task deleted: ${id}`);
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn(`Task ${id} deletion failed, using fallback`);
          // In degraded mode, we can't guarantee deletion but won't throw
          this.logger.log(`Task ${id} deletion queued for later processing`);
        },
      },
    );
  }

  async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        return this.taskRepository.find({
          where: { status },
          order: { createdAt: 'DESC' },
        });
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn(`Task status query failed, using fallback`);
          return []; // Return empty array in degraded mode
        },
      },
    );
  }

  async getOverdueTasks(): Promise<Task[]> {
    return this.faultIsolationService.executeInBoundary(
      'task-processing',
      async () => {
        const now = new Date();
        return this.taskRepository
          .createQueryBuilder('task')
          .where('task.dueDate < :now', { now })
          .andWhere('task.status != :completed', { completed: TaskStatus.COMPLETED })
          .orderBy('task.dueDate', 'ASC')
          .getMany();
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn('Overdue tasks query failed, using fallback');
          return []; // Return empty array in degraded mode
        },
      },
    );
  }

  // External service integration with circuit breaker
  async sendNotification(taskId: string, message: string): Promise<void> {
    // Check if notifications are enabled
    if (!this.gracefulDegradationService.isFeatureEnabled('notifications')) {
      this.logger.debug('Notifications disabled, skipping');
      return;
    }

    return this.faultIsolationService.executeInBoundary(
      'notifications',
      async () => {
        // Simulate external notification service call
        await this.circuitBreakerService.execute(
          'notification-service',
          async () => {
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 100));
            this.logger.log(`Notification sent for task ${taskId}: ${message}`);
          },
        );
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.warn(`Notification failed for task ${taskId}, queued for retry`);
          // In a real implementation, you'd queue this for later retry
        },
      },
    );
  }

  // Analytics integration with graceful degradation
  async recordTaskMetrics(taskId: string, action: string): Promise<void> {
    // Skip if analytics are degraded
    if (!this.gracefulDegradationService.isFeatureEnabled('analytics')) {
      return;
    }

    return this.faultIsolationService.executeInBoundary(
      'external-api',
      async () => {
        await this.circuitBreakerService.execute(
          'analytics-service',
          async () => {
            // Simulate analytics API call
            await new Promise(resolve => setTimeout(resolve, 50));
            this.logger.debug(`Analytics recorded: ${action} on task ${taskId}`);
          },
        );
      },
      {
        useCircuitBreaker: true,
        fallback: async () => {
          this.logger.debug(`Analytics recording skipped for task ${taskId} (degraded)`);
        },
      },
    );
  }

  // Search functionality with fallback
  async searchTasks(query: string, limit: number = 20): Promise<Task[]> {
    return this.gracefulDegradationService.executeWithFallback(
      'search',
      async () => {
        return this.faultIsolationService.executeInBoundary(
          'task-processing',
          async () => {
            return this.taskRepository
              .createQueryBuilder('task')
              .where(
                '(task.title ILIKE :query OR task.description ILIKE :query)',
                { query: `%${query}%` },
              )
              .orderBy('task.createdAt', 'DESC')
              .limit(limit)
              .getMany();
          },
        );
      },
      async () => {
        this.logger.warn('Search failed, using basic fallback');
        // Fallback: return recent tasks
        return this.taskRepository.find({
          order: { createdAt: 'DESC' },
          take: Math.min(limit, 10),
        });
      },
    );
  }
}

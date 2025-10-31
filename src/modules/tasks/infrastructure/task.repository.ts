import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Task } from '../entities/task.entity';
import { TaskAggregate } from '../domain/task.aggregate';
import { ITaskRepository } from '../domain/task.repository.interface';

/**
 * Infrastructure layer implementation of TaskRepository
 * Handles data persistence operations for Task domain objects
 * Implements the repository pattern with TypeORM
 *
 * This repository serves as the bridge between the domain layer and
 * the data persistence layer, providing:
 * - Domain object persistence and retrieval
 * - Data mapping between aggregates and entities
 * - Transaction management for data consistency
 * - Query optimization for performance
 * - Error handling and logging
 *
 * Key responsibilities:
 * - Aggregate-to-entity mapping and vice versa
 * - Complex query execution with filtering and pagination
 * - Transactional data operations
 * - Performance optimization through query building
 */
@Injectable()
export class TaskRepository implements ITaskRepository {
  /** Logger instance for repository operations */
  private readonly logger = new Logger(TaskRepository.name);

  /**
   * Constructor for TaskRepository
   * Injects TypeORM repository and data source for database operations
   *
   * @param taskRepository - TypeORM repository for Task entity operations
   * @param dataSource - TypeORM data source for transaction management
   */
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Saves a task aggregate to the database using transactions
   *
   * This method ensures data consistency by wrapping the save operation
   * in a database transaction. It maps the domain aggregate to a database
   * entity before persistence.
   *
   * @param taskAggregate - Domain aggregate to persist
   * @throws Error if the save operation fails
   */
  async save(taskAggregate: TaskAggregate): Promise<void> {
    try {
      this.logger.debug(`Saving task aggregate: ${taskAggregate.getId()}`);

      // Map domain aggregate to database entity
      const task = this.mapAggregateToEntity(taskAggregate);

      // Execute save operation within transaction for consistency
      await this.dataSource.transaction(async entityManager => {
        await entityManager.save(task);
      });

      this.logger.debug(`Task aggregate saved successfully: ${taskAggregate.getId()}`);
    } catch (error) {
      this.logger.error(`Failed to save task aggregate: ${taskAggregate.getId()}`, error);
      throw error;
    }
  }

  /**
   * Finds a task by ID and returns domain aggregate
   *
   * Retrieves a single task from the database and converts it to a domain aggregate.
   * Uses query builder with cache disabled to ensure fresh data retrieval.
   * This method is optimized for single entity lookups.
   *
   * @param id - Task UUID to search for
   * @returns TaskAggregate instance or null if not found
   */
  async findById(id: string): Promise<TaskAggregate | null> {
    try {
      this.logger.debug(`Finding task by ID: ${id}`);

      // Use query builder to ensure we get fresh data
      // Cache is disabled to prevent stale data issues
      const task = await this.taskRepository
        .createQueryBuilder('task')
        .where('task.id = :id', { id })
        .cache(false) // Disable cache to always get fresh data
        .getOne();

      if (task) {
        const aggregate = this.mapEntityToAggregate(task);
        this.logger.debug(`Task found and mapped to aggregate: ${id}`);
        return aggregate;
      }

      this.logger.debug(`Task not found: ${id}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to find task by ID: ${id}`, error);
      throw error;
    }
  }

  /**
   * Retrieves paginated tasks with optional filtering and search
   *
   * This method performs complex queries with multiple filter criteria,
   * full-text search, and pagination. It includes user relationships
   * for complete task information and returns both results and total count.
   *
   * Query optimizations:
   * - Uses left join for user relationships
   * - Applies filters conditionally for performance
   * - Uses ILIKE for case-insensitive search
   * - Implements efficient pagination with skip/take
   *
   * @param status - Filter by task status (optional)
   * @param priority - Filter by task priority (optional)
   * @param page - Page number for pagination (default: 1)
   * @param limit - Items per page limit (default: 10)
   * @param search - Search text for title/description (optional, case-insensitive)
   * @returns Object with paginated items array and total count
   */
  async findTasks(
    status?: string,
    priority?: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<{ items: Task[]; total: number }> {
    try {
      this.logger.debug(`Finding tasks with filters - status: ${status}, priority: ${priority}, search: ${search}`);

      // Build query with user relationship included
      const queryBuilder = this.taskRepository
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.user', 'user'); // Include user relationship

      // Apply status filter if provided
      if (status) {
        queryBuilder.andWhere('task.status = :status', { status });
      }

      // Apply priority filter if provided
      if (priority) {
        queryBuilder.andWhere('task.priority = :priority', { priority });
      }

      // Apply full-text search if provided (case-insensitive PostgreSQL ILIKE)
      if (search) {
        queryBuilder.andWhere('(task.title ILIKE :search OR task.description ILIKE :search)', {
          search: `%${search}%`,
        });
      }

      // Apply pagination and get results with count in single query
      const [items, total] = await queryBuilder
        .skip((page - 1) * limit) // Calculate offset from page number
        .take(limit) // Limit results per page
        .getManyAndCount();

      this.logger.debug(`Found ${total} tasks, returning page ${page} with ${items.length} items`);
      return { items, total };
    } catch (error) {
      this.logger.error('Failed to find tasks with filters', error);
      throw error;
    }
  }

  /**
   * Finds tasks assigned to a specific user or unassigned tasks
   *
   * This method supports user-specific task queries, allowing retrieval
   * of tasks assigned to a particular user or all unassigned tasks.
   * Optional status filtering can be applied on top of user filtering.
   *
   * Use cases:
   * - User dashboards showing assigned tasks
   * - Administrative views of unassigned tasks
   * - Task reassignment workflows
   *
   * @param userId - User UUID for assigned tasks, or null for unassigned tasks
   * @param status - Optional status filter to apply with user filter
   * @returns Array of Task entities matching the criteria
   */
  async findByAssignee(userId: string | null, status?: string): Promise<Task[]> {
    try {
      this.logger.debug(`Finding tasks by assignee: ${userId}, status: ${status}`);

      const queryBuilder = this.taskRepository.createQueryBuilder('task');

      // Filter by user assignment (assigned vs unassigned)
      if (userId) {
        queryBuilder.where('task.userId = :userId', { userId });
      } else {
        queryBuilder.where('task.userId IS NULL'); // Unassigned tasks
      }

      // Apply status filter if provided
      if (status) {
        queryBuilder.andWhere('task.status = :status', { status });
      }

      const tasks = await queryBuilder.getMany();
      this.logger.debug(`Found ${tasks.length} tasks for assignee query`);
      return tasks;
    } catch (error) {
      this.logger.error(`Failed to find tasks by assignee: ${userId}`, error);
      throw error;
    }
  }

  /**
   * Deletes a task from the database using transactions
   *
   * This method permanently removes a task from the database.
   * The operation is wrapped in a transaction to ensure data consistency
   * and to allow for potential cleanup operations or audit logging.
   *
   * @param id - Task UUID to delete
   * @throws Error if deletion fails or task doesn't exist
   */
  async delete(id: string): Promise<void> {
    try {
      this.logger.debug(`Deleting task: ${id}`);

      // Execute deletion within transaction for consistency
      await this.dataSource.transaction(async entityManager => {
        await entityManager.delete(Task, id);
      });

      this.logger.debug(`Task deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete task: ${id}`, error);
      throw error;
    }
  }

  /**
   * Maps domain aggregate to database entity
   *
   * This private method converts a domain TaskAggregate to a database Task entity.
   * It extracts all relevant properties from the aggregate and maps them to the
   * entity structure expected by TypeORM and the database.
   *
   * Mapping considerations:
   * - assigneeId (domain) -> userId (database)
   * - All other properties map directly
   * - Timestamps are handled by the database/entity decorators
   *
   * @param taskAggregate - Domain aggregate to convert
   * @returns Task entity ready for database operations
   * @private
   */
  private mapAggregateToEntity(taskAggregate: TaskAggregate): Task {
    const task = new Task();

    // Map all aggregate properties to entity fields
    task.id = taskAggregate.getId();
    task.title = taskAggregate.getTitle();
    task.description = taskAggregate.getDescription();
    task.status = taskAggregate.getStatus();
    task.priority = taskAggregate.getPriority();
    task.dueDate = taskAggregate.getDueDate();
    task.userId = taskAggregate.getAssigneeId(); // Domain assigneeId maps to database userId

    return task;
  }

  /**
   * Maps database entity to domain aggregate
   *
   * This private method converts a database Task entity to a domain TaskAggregate.
   * It reconstructs the domain object from the persisted data, ensuring that
   * all business rules and invariants are maintained.
   *
   * Mapping considerations:
   * - userId (database) -> assigneeId (domain)
   * - Status handling requires special logic for non-default values
   * - Domain events are not replayed during reconstruction
   *
   * @param task - Database entity to convert
   * @returns TaskAggregate ready for domain operations
   * @private
   */
  private mapEntityToAggregate(task: Task): TaskAggregate {
    // Create aggregate with the entity's ID
    const taskAggregate = new TaskAggregate(task.id);

    // Initialize aggregate with entity data
    // Map database userId to domain assigneeId
    taskAggregate.createTask(
      task.title,
      task.description,
      task.priority,
      task.dueDate,
      task.userId, // Database userId maps to domain assigneeId
    );

    // Handle status updates if different from default PENDING
    // This ensures the aggregate reflects the actual persisted state
    if (task.status !== 'PENDING') {
      taskAggregate.updateTask(undefined, undefined, task.status, undefined, undefined);
    }

    return taskAggregate;
  }
}

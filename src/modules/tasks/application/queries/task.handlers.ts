import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetTaskByIdQuery, GetTasksQuery, GetTasksByAssigneeQuery } from './task.queries';
import { TaskRepository } from '../../infrastructure/task.repository';
import { Task } from '../../entities/task.entity';

/**
 * CQRS Query Handler for retrieving a single task by ID
 * Maps domain aggregate back to entity for API responses
 *
 * This handler is responsible for:
 * - Executing single task retrieval queries
 * - Converting domain aggregates to API-friendly entities
 * - Handling not-found scenarios gracefully
 * - Maintaining read operation performance
 *
 * @remarks
 * - Optimized for single entity retrieval
 * - Returns null for non-existent tasks (graceful degradation)
 * - Maps domain properties to entity structure for API compatibility
 * - No side effects or state modifications
 */
@QueryHandler(GetTaskByIdQuery)
export class GetTaskByIdHandler implements IQueryHandler<GetTaskByIdQuery> {
  /**
   * Constructor for GetTaskByIdHandler
   * @param taskRepository - Repository for task data access operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the get task by ID query
   *
   * This method performs the following steps:
   * 1. Retrieves the task aggregate from the repository
   * 2. Returns null if task doesn't exist (graceful handling)
   * 3. Maps domain aggregate properties to entity structure
   * 4. Returns API-compatible task entity
   *
   * @param query - Query containing the task ID to retrieve
   * @returns Task entity mapped for API response or null if not found
   */
  async execute(query: GetTaskByIdQuery): Promise<Task | null> {
    // Retrieve task aggregate from repository
    const taskAggregate = await this.taskRepository.findById(query.id);

    // Return null for non-existent tasks (graceful degradation)
    if (!taskAggregate) return null;

    // Map domain aggregate back to entity for API response
    // This converts domain objects to database entities for API compatibility
    const task = new Task();
    task.id = taskAggregate.getId();
    task.title = taskAggregate.getTitle();
    task.description = taskAggregate.getDescription();
    task.status = taskAggregate.getStatus();
    task.priority = taskAggregate.getPriority();
    task.dueDate = taskAggregate.getDueDate();
    task.userId = taskAggregate.getAssigneeId(); // Map assigneeId to userId for API

    return task;
  }
}

/**
 * CQRS Query Handler for retrieving paginated task lists with filtering
 * Delegates to repository for complex query operations
 *
 * This handler is responsible for:
 * - Executing complex task list queries with multiple filters
 * - Handling pagination parameters and limits
 * - Delegating to repository for optimized database operations
 * - Returning structured results with metadata
 *
 * @remarks
 * - Supports complex filtering (status, priority, search)
 * - Handles pagination efficiently
 * - Delegates heavy lifting to repository layer
 * - Returns both data and total count for pagination UI
 */
@QueryHandler(GetTasksQuery)
export class GetTasksHandler implements IQueryHandler<GetTasksQuery> {
  /**
   * Constructor for GetTasksHandler
   * @param taskRepository - Repository for complex task query operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the get tasks query with filtering and pagination
   *
   * This method delegates the complex query execution to the repository layer,
   * which handles database optimization, filtering, and pagination efficiently.
   * The repository returns both the paginated results and total count.
   *
   * @param query - Query containing filter and pagination parameters
   * @returns Object with items array and total count for pagination support
   */
  async execute(query: GetTasksQuery): Promise<{ items: Task[]; total: number }> {
    // Delegate complex query execution to repository layer
    // Repository handles filtering, pagination, and database optimization
    return this.taskRepository.findTasks(
      query.status,
      query.priority,
      query.page,
      query.limit,
      query.search,
    );
  }
}

/**
 * CQRS Query Handler for retrieving tasks by assignee
 * Used for user-specific task listings and unassigned task queries
 *
 * This handler is responsible for:
 * - Executing user-centric task queries
 * - Supporting both assigned and unassigned task retrieval
 * - Applying optional status filtering on assignee results
 * - Optimizing queries for user dashboard and profile views
 *
 * @remarks
 * - Handles null userId for unassigned tasks
 * - Supports additional status filtering
 * - Used in user dashboards and administrative views
 * - Optimized for frequent user-specific queries
 */
@QueryHandler(GetTasksByAssigneeQuery)
export class GetTasksByAssigneeHandler implements IQueryHandler<GetTasksByAssigneeQuery> {
  /**
   * Constructor for GetTasksByAssigneeHandler
   * @param taskRepository - Repository for assignee-based task queries
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the get tasks by assignee query
   *
   * This method retrieves tasks based on user assignment, supporting:
   * - Tasks assigned to a specific user (by userId)
   * - Unassigned tasks (when userId is null)
   * - Optional status filtering on the assignee results
   *
   * @param query - Query containing user ID and optional status filter
   * @returns Array of Task entities assigned to the specified user or unassigned
   */
  async execute(query: GetTasksByAssigneeQuery): Promise<Task[]> {
    // Delegate to repository for optimized assignee-based queries
    // Repository handles both assigned and unassigned task scenarios
    return this.taskRepository.findByAssignee(query.userId, query.status);
  }
}

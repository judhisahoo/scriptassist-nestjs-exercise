import { TaskAggregate } from '../domain/task.aggregate';
import { Task } from '../entities/task.entity';

/**
 * Repository interface for Task domain operations
 * Defines the contract for data access layer in Domain-Driven Design
 * Provides abstraction over data persistence mechanisms
 *
 * This interface establishes the contract between the domain layer
 * and the infrastructure layer, ensuring loose coupling and
 * testability. It defines all operations needed to persist and
 * retrieve Task aggregates while hiding implementation details.
 *
 * Key principles:
 * - Domain objects (aggregates) for write operations
 * - Data transfer objects (entities) for read operations
 * - Asynchronous operations for scalability
 * - Null-safe return values for error handling
 * - Consistent parameter and return types
 */
export interface ITaskRepository {
  /**
   * Saves a task aggregate to the data store
   *
   * This method persists the complete state of a task aggregate,
   * including all domain invariants and business rules. It handles
   * both creation of new tasks and updates to existing ones.
   *
   * @param task - TaskAggregate instance to persist
   * @throws Error if persistence operation fails
   */
  save(task: TaskAggregate): Promise<void>;

  /**
   * Finds a task by its unique identifier
   *
   * Retrieves a complete task aggregate for domain operations.
   * Returns null if the task doesn't exist, allowing graceful
   * handling of not-found scenarios.
   *
   * @param id - Task UUID (must be valid UUID format)
   * @returns TaskAggregate instance or null if not found
   */
  findById(id: string): Promise<TaskAggregate | null>;

  /**
   * Retrieves paginated list of tasks with optional filtering
   *
   * This read operation supports complex querying with multiple
   * filter criteria and pagination. Returns both the paginated
   * results and total count for UI pagination controls.
   *
   * @param status - Filter by task status (string representation)
   * @param priority - Filter by task priority (string representation)
   * @param page - Page number for pagination (1-based)
   * @param limit - Number of items per page (max recommended: 100)
   * @param search - Search text for title/description (case-insensitive)
   * @returns Object containing items array and total count
   */
  findTasks(
    status?: string,
    priority?: string,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ items: Task[]; total: number }>;

  /**
   * Finds tasks assigned to a specific user
   *
   * Retrieves all tasks assigned to a particular user, with optional
   * status filtering. Used for user dashboards and task assignment views.
   *
   * @param userId - User UUID (required, cannot be null)
   * @param status - Optional status filter (string representation)
   * @returns Array of Task entities assigned to the user
   */
  findByAssignee(userId: string, status?: string): Promise<Task[]>;

  /**
   * Deletes a task from the data store
   *
   * Permanently removes a task from the system. This operation
   * should be used carefully as it represents data loss.
   *
   * @param id - Task UUID to delete (must exist)
   * @throws Error if deletion fails or task doesn't exist
   */
  delete(id: string): Promise<void>;
}

/**
 * Query to retrieve a single task by its ID
 * Used for fetching individual task details
 *
 * This query represents a read operation in the CQRS pattern,
 * specifically designed for retrieving detailed information about
 * a single task. It follows the principle of separating read
 * operations from write operations for better scalability.
 *
 * @remarks
 * - Optimized for single entity retrieval
 * - Returns null if task doesn't exist (graceful handling)
 * - Used by task detail views and update operations
 * - Read-only operation with no side effects
 */
export class GetTaskByIdQuery {
  /**
   * Creates a new get task by ID query
   *
   * @param id - UUID of the task to retrieve (required, must be valid UUID format)
   */
  constructor(public readonly id: string) {}
}

/**
 * Query to retrieve paginated list of tasks with optional filtering
 * Supports status, priority, and text search filtering
 *
 * This query enables complex read operations for task listings with
 * multiple filtering and pagination options. It supports:
 * - Status-based filtering (PENDING, IN_PROGRESS, COMPLETED, OVERDUE)
 * - Priority-based filtering (LOW, MEDIUM, HIGH)
 * - Full-text search across title and description fields
 * - Configurable pagination with page size and number
 *
 * @remarks
 * - All parameters are optional for flexible querying
 * - Pagination defaults are handled by the query handler
 * - Search is case-insensitive and supports partial matches
 * - Returns both items and total count for pagination UI
 */
export class GetTasksQuery {
  /**
   * Creates a new get tasks query with filtering and pagination
   *
   * @param status - Filter by task status as string (optional, will be converted to enum)
   * @param priority - Filter by task priority as string (optional, will be converted to enum)
   * @param page - Page number for pagination (optional, defaults to 1)
   * @param limit - Number of items per page (optional, defaults to 10)
   * @param search - Search text for title/description (optional, case-insensitive partial match)
   */
  constructor(
    public readonly status?: string,
    public readonly priority?: string,
    public readonly page?: number,
    public readonly limit?: number,
    public readonly search?: string,
  ) {}
}

/**
 * Query to retrieve tasks assigned to a specific user
 * Used for user-specific task listings and unassigned task queries
 *
 * This query supports user-centric task views, allowing users to see
 * their assigned tasks or administrators to view unassigned tasks.
 * It can be combined with status filtering for more specific queries.
 *
 * @remarks
 * - userId can be null to retrieve unassigned tasks
 * - Optional status filtering for more granular results
 * - Used in dashboards, user profiles, and task assignment views
 * - Supports both individual user views and administrative oversight
 */
export class GetTasksByAssigneeQuery {
  /**
   * Creates a new get tasks by assignee query
   *
   * @param userId - UUID of the user or null for unassigned tasks
   * @param status - Optional status filter as string (will be converted to enum)
   */
  constructor(
    public readonly userId: string | null,
    public readonly status?: string,
  ) {}
}

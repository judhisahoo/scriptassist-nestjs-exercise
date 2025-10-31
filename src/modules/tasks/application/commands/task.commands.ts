/**
 * Command to create a new task
 * Part of the CQRS pattern for task creation operations
 *
 * This command encapsulates all the data needed to create a new task
 * in the system. It follows the CQRS principle of separating write
 * operations from read operations.
 *
 * @remarks
 * - All properties are readonly to ensure immutability
 * - Constructor parameters are validated by the command handler
 * - This command triggers domain events and business logic execution
 */
export class CreateTaskCommand {
  /**
   * Creates a new task creation command
   *
   * @param title - Task title (required, non-empty string)
   * @param description - Task description (can be empty string for no description)
   * @param priority - Task priority level as string (will be converted to enum)
   * @param dueDate - Due date as ISO string or null for no due date
   * @param assigneeId - UUID of assigned user or null for unassigned tasks
   */
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly priority: string,
    public readonly dueDate: string | null,
    public readonly assigneeId: string | null,
  ) {}
}

/**
 * Command to update an existing task
 * Supports partial updates - only provided fields will be changed
 *
 * This command allows updating any combination of task properties.
 * Undefined values indicate that the field should not be updated.
 * This follows the CQRS pattern for write operations.
 *
 * @remarks
 * - All properties are optional to support partial updates
 * - Null values have different meaning than undefined (null clears the field)
 * - Command handler validates that at least one field is being updated
 */
export class UpdateTaskCommand {
  /**
   * Creates a new task update command
   *
   * @param id - Task UUID to update (required)
   * @param title - New title (optional, undefined means no change)
   * @param description - New description (optional, undefined means no change)
   * @param status - New status as string (optional, will be converted to enum)
   * @param priority - New priority as string (optional, will be converted to enum)
   * @param dueDate - New due date as ISO string or null (optional, null clears due date)
   */
  constructor(
    public readonly id: string,
    public readonly title?: string,
    public readonly description?: string,
    public readonly status?: string,
    public readonly priority?: string,
    public readonly dueDate?: string | null,
  ) {}
}

/**
 * Command to mark a task as completed
 * Changes task status to COMPLETED
 *
 * This command represents a specific business operation that
 * transitions a task to the COMPLETED state. The domain logic
 * ensures that only valid state transitions are allowed.
 *
 * @remarks
 * - This is a specialized command for completion (not a general update)
 * - Domain rules prevent completing already completed tasks
 * - Triggers completion-specific business logic and events
 */
export class CompleteTaskCommand {
  /**
   * Creates a new task completion command
   *
   * @param id - Task UUID to complete (required, must exist and not be completed)
   */
  constructor(public readonly id: string) {}
}

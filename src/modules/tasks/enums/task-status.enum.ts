/**
 * Enumeration of possible task statuses in the task management system
 *
 * This enum defines the complete lifecycle states that a task can transition through.
 * Each status represents a distinct phase in the task's workflow and is used for:
 * - Business logic validation (e.g., preventing completion of already completed tasks)
 * - UI state management and visual indicators
 * - Reporting and analytics (task distribution by status)
 * - API filtering and search capabilities
 * - Workflow automation and notifications
 *
 * Status Transition Rules:
 * - PENDING → IN_PROGRESS (work started)
 * - IN_PROGRESS → COMPLETED (work finished)
 * - PENDING/IN_PROGRESS → OVERDUE (past due date)
 * - OVERDUE → COMPLETED (completed late)
 * - No direct transition from COMPLETED to other states
 *
 * @remarks
 * - Used in database schema as enum type for data integrity
 * - Referenced in DTOs for API validation and documentation
 * - Critical for domain logic in TaskAggregate business rules
 * - Supports internationalization through string values
 */
export enum TaskStatus {
  /**
   * Initial status for newly created tasks
   * Indicates the task exists but no work has begun
   * Default status for task creation
   */
  PENDING = 'PENDING',

  /**
   * Active status when work is currently being performed
   * Indicates the task is in progress and actively being worked on
   * Used for workload tracking and resource allocation
   */
  IN_PROGRESS = 'IN_PROGRESS',

  /**
   * Terminal status indicating successful completion
   * Task has been finished and meets all requirements
   * No further status transitions allowed from this state
   */
  COMPLETED = 'COMPLETED',

  /**
   * Special status for tasks past their due date
   * Can coexist with PENDING or IN_PROGRESS
   * Used for escalation and priority management
   * Triggers automated notifications and alerts
   */
  OVERDUE = 'OVERDUE',
}

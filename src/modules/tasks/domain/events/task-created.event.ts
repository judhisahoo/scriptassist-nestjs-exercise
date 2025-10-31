/**
 * Domain event emitted when a new task is created
 * Part of the CQRS event sourcing pattern
 *
 * This event represents the successful creation of a new task in the system.
 * It captures the essential information about the task creation for:
 * - Audit logging and compliance tracking
 * - Notification systems to alert stakeholders
 * - Analytics and reporting systems
 * - Event-driven architecture integrations
 *
 * @remarks
 * - Emitted by TaskAggregate.createTask() method
 * - Contains immutable snapshot of creation data
 * - Used for cross-system integration and monitoring
 * - Supports event sourcing and CQRS patterns
 */
export class TaskCreatedEvent {
  /**
   * Creates a new task created domain event
   *
   * @param taskId - Unique identifier of the created task (UUID format)
   * @param title - Title of the newly created task (for notifications and logging)
   * @param assigneeId - ID of the user assigned to the task or null if unassigned
   */
  constructor(
    public readonly taskId: string,
    public readonly title: string,
    public readonly assigneeId: string | null,
  ) {}

  /**
   * Gets the event type identifier for event routing
   * @returns Event type string for event bus routing
   */
  getEventType(): string {
    return 'TaskCreatedEvent';
  }

  /**
   * Gets the aggregate ID for event sourcing
   * @returns Task aggregate ID for event correlation
   */
  getAggregateId(): string {
    return this.taskId;
  }
}

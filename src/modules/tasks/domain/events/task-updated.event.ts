/**
 * Domain event emitted when a task is updated
 * Part of the CQRS event sourcing pattern
 *
 * This event represents changes made to an existing task, capturing
 * the updated state for audit, notification, and integration purposes.
 * It enables:
 * - Change tracking and audit trails
 * - Real-time notifications to stakeholders
 * - Synchronization with external systems
 * - Analytics on task modification patterns
 *
 * @remarks
 * - Emitted by TaskAggregate.updateTask() method
 * - Contains current state after successful update
 * - Supports partial update tracking
 * - Enables event-driven side effects
 */
export class TaskUpdatedEvent {
  /**
   * Creates a new task updated domain event
   *
   * @param taskId - Unique identifier of the updated task (UUID format)
   * @param title - Current title of the task after update (may be unchanged)
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
    return 'TaskUpdatedEvent';
  }

  /**
   * Gets the aggregate ID for event sourcing
   * @returns Task aggregate ID for event correlation
   */
  getAggregateId(): string {
    return this.taskId;
  }
}

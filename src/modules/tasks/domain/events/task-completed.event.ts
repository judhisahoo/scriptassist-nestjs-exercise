/**
 * Domain event emitted when a task is marked as completed
 * Part of the CQRS event sourcing pattern
 *
 * This event signifies the successful completion of a task, marking
 * a significant milestone in the task lifecycle. It enables:
 * - Completion tracking and reporting
 * - Notification of task completion to stakeholders
 * - Workflow progression and automation triggers
 * - Performance metrics and analytics
 *
 * @remarks
 * - Emitted by TaskAggregate.completeTask() method
 * - Represents final state transition in task workflow
 * - Triggers completion-specific business processes
 * - Used for productivity tracking and reporting
 */
export class TaskCompletedEvent {
  /**
   * Creates a new task completed domain event
   *
   * @param taskId - Unique identifier of the completed task (UUID format)
   * @param assigneeId - ID of the user who completed the task or null if unassigned
   */
  constructor(
    public readonly taskId: string,
    public readonly assigneeId: string | null,
  ) {}

  /**
   * Gets the event type identifier for event routing
   * @returns Event type string for event bus routing
   */
  getEventType(): string {
    return 'TaskCompletedEvent';
  }

  /**
   * Gets the aggregate ID for event sourcing
   * @returns Task aggregate ID for event correlation
   */
  getAggregateId(): string {
    return this.taskId;
  }
}

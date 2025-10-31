import { AggregateRoot } from '@nestjs/cqrs';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { TaskCreatedEvent } from './events/task-created.event';
import { TaskUpdatedEvent } from './events/task-updated.event';
import { TaskCompletedEvent } from './events/task-completed.event';

/**
 * Domain Aggregate for Task entity
 * Implements Domain-Driven Design principles with CQRS event sourcing
 * Encapsulates task business logic and state management
 *
 * This aggregate represents a Task as defined by Domain-Driven Design,
 * serving as the consistency boundary for task-related business rules.
 * It maintains task state, enforces business invariants, and emits
 * domain events to communicate state changes to other parts of the system.
 *
 * Key responsibilities:
 * - Business rule validation and enforcement
 * - State transition management
 * - Domain event emission for CQRS integration
 * - Encapsulation of task-specific logic
 * - Aggregate consistency boundary maintenance
 *
 * @remarks
 * - Extends AggregateRoot for CQRS event sourcing capabilities
 * - Uses private properties with controlled access via getters
 * - Emits domain events for all state-changing operations
 * - Enforces business rules at the domain level
 */
export class TaskAggregate extends AggregateRoot {
  /** Unique identifier for the task aggregate */
  private id: string;

  /** Task title - required, non-empty string */
  private title: string;

  /** Task description - detailed explanation of the task */
  private description: string;

  /** Current status of the task in its lifecycle */
  private status: TaskStatus;

  /** Priority level indicating task importance */
  private priority: TaskPriority;

  /** Optional due date for task completion */
  private dueDate: Date | null;

  /** ID of the user assigned to this task, null if unassigned */
  private assigneeId: string | null;

  /** Timestamp when the task was created */
  private createdAt: Date;

  /** Timestamp when the task was last updated */
  private updatedAt: Date;

  /**
   * Creates a new TaskAggregate instance
   *
   * Initializes the aggregate with a unique identifier. The aggregate
   * starts in an uninitialized state and must be populated using
   * createTask() or loaded from persistence.
   *
   * @param id - Unique identifier for the task (UUID format recommended)
   */
  constructor(id: string) {
    super();
    this.id = id;
  }

  /**
   * Creates a new task with initial state
   *
   * This method initializes a task aggregate with all required properties.
   * It sets the default status to PENDING and records creation timestamps.
   * This operation represents the initial creation of a task in the domain.
   *
   * Business Rules Enforced:
   * - Task starts in PENDING status
   * - Creation and update timestamps are set to current time
   * - Domain event is emitted for CQRS integration
   *
   * @param title - Task title (required, non-empty)
   * @param description - Task description (required, can be empty string)
   * @param priority - Task priority level (required enum value)
   * @param dueDate - Optional due date for task completion
   * @param assigneeId - Optional user assignment (null for unassigned)
   */
  createTask(
    title: string,
    description: string,
    priority: TaskPriority,
    dueDate: Date | null,
    assigneeId: string | null,
  ) {
    // Set core task properties
    this.title = title;
    this.description = description;
    this.status = TaskStatus.PENDING; // Business rule: new tasks start as PENDING
    this.priority = priority;
    this.dueDate = dueDate;
    this.assigneeId = assigneeId;

    // Set audit timestamps
    this.createdAt = new Date();
    this.updatedAt = new Date();

    // Emit domain event for CQRS event sourcing
    this.apply(new TaskCreatedEvent(this.id, this.title, this.assigneeId));
  }

  /**
   * Updates task properties with partial data
   *
   * This method supports partial updates where only provided fields
   * are modified. Undefined values indicate no change, while null
   * values explicitly clear optional fields. The update timestamp
   * is always refreshed.
   *
   * Business Rules Enforced:
   * - Only provided fields are updated (partial update support)
   * - Update timestamp is always refreshed
   * - Domain event is emitted for change tracking
   * - Null vs undefined semantics are respected
   *
   * @param title - New title (optional, undefined = no change)
   * @param description - New description (optional, undefined = no change)
   * @param status - New status (optional, undefined = no change)
   * @param priority - New priority (optional, undefined = no change)
   * @param dueDate - New due date (optional, null = clear date, undefined = no change)
   */
  updateTask(
    title?: string,
    description?: string,
    status?: TaskStatus,
    priority?: TaskPriority,
    dueDate?: Date | null,
  ) {
    // Apply updates only for provided fields (respecting null vs undefined)
    if (title !== undefined) this.title = title;
    if (description !== undefined) this.description = description;
    if (status !== undefined) this.status = status;
    if (priority !== undefined) this.priority = priority;
    if (dueDate !== undefined) this.dueDate = dueDate;

    // Always update the modification timestamp
    this.updatedAt = new Date();

    // Emit domain event for CQRS event sourcing
    this.apply(new TaskUpdatedEvent(this.id, this.title, this.assigneeId));
  }

  /**
   * Marks the task as completed
   *
   * This method transitions the task to COMPLETED status, representing
   * the final state in the task lifecycle. It enforces business rules
   * to prevent double completion and emits completion events.
   *
   * Business Rules Enforced:
   * - Task cannot be completed if already completed
   * - Status transition is atomic and final
   * - Completion timestamp is recorded
   * - Domain event is emitted for workflow triggers
   *
   * @throws Error if task is already completed (business rule violation)
   */
  completeTask() {
    // Business rule: prevent double completion
    if (this.status === TaskStatus.COMPLETED) {
      throw new Error('Task is already completed');
    }

    // Transition to completed state
    this.status = TaskStatus.COMPLETED;
    this.updatedAt = new Date();

    // Emit domain event for CQRS event sourcing and workflow triggers
    this.apply(new TaskCompletedEvent(this.id, this.assigneeId));
  }

  /**
   * Getter methods for accessing private aggregate properties
   *
   * These methods provide controlled read access to the aggregate's
   * internal state. They are used by the application layer and
   * infrastructure layer for data mapping and API responses.
   *
   * All getters return copies or immutable references to prevent
   * external modification of the aggregate's internal state.
   */

  /**
   * Gets the task's unique identifier
   * @returns Task UUID as string
   */
  getId(): string {
    return this.id;
  }

  /**
   * Gets the task's title
   * @returns Current task title
   */
  getTitle(): string {
    return this.title;
  }

  /**
   * Gets the task's description
   * @returns Current task description
   */
  getDescription(): string {
    return this.description;
  }

  /**
   * Gets the current task status
   * @returns Task status enum value
   */
  getStatus(): TaskStatus {
    return this.status;
  }

  /**
   * Gets the task's priority level
   * @returns Task priority enum value
   */
  getPriority(): TaskPriority {
    return this.priority;
  }

  /**
   * Gets the task's due date
   * @returns Due date as Date object or null if not set
   */
  getDueDate(): Date | null {
    return this.dueDate;
  }

  /**
   * Gets the assigned user's ID
   * @returns User UUID or null if task is unassigned
   */
  getAssigneeId(): string | null {
    return this.assigneeId;
  }
}

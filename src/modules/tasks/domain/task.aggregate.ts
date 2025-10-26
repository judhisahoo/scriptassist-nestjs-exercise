import { AggregateRoot } from '@nestjs/cqrs';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { TaskCreatedEvent } from './events/task-created.event';
import { TaskUpdatedEvent } from './events/task-updated.event';
import { TaskCompletedEvent } from './events/task-completed.event';

export class TaskAggregate extends AggregateRoot {
  private id: string;
  private title: string;
  private description: string;
  private status: TaskStatus;
  private priority: TaskPriority;
  private dueDate: Date | null;
  private assigneeId: string | null;
  private createdAt: Date;
  private updatedAt: Date;

  constructor(id: string) {
    super();
    this.id = id;
  }

  createTask(
    title: string,
    description: string,
    priority: TaskPriority,
    dueDate: Date | null,
    assigneeId: string | null,
  ) {
    this.title = title;
    this.description = description;
    this.status = TaskStatus.PENDING;
    this.priority = priority;
    this.dueDate = dueDate;
    this.assigneeId = assigneeId;
    this.createdAt = new Date();
    this.updatedAt = new Date();

    this.apply(new TaskCreatedEvent(this.id, this.title, this.assigneeId));
  }

  updateTask(
    title?: string,
    description?: string,
    status?: TaskStatus,
    priority?: TaskPriority,
    dueDate?: Date | null,
  ) {
    if (title) this.title = title;
    if (description) this.description = description;
    if (status !== undefined) this.status = status;
    if (priority) this.priority = priority;
    if (dueDate !== undefined) this.dueDate = dueDate;
    this.updatedAt = new Date();

    this.apply(new TaskUpdatedEvent(this.id, this.title, this.assigneeId));
  }

  completeTask() {
    if (this.status === TaskStatus.COMPLETED) {
      throw new Error('Task is already completed');
    }

    this.status = TaskStatus.COMPLETED;
    this.updatedAt = new Date();

    this.apply(new TaskCompletedEvent(this.id, this.assigneeId));
  }

  // Getters
  getId(): string {
    return this.id;
  }

  getTitle(): string {
    return this.title;
  }

  getDescription(): string {
    return this.description;
  }

  getStatus(): TaskStatus {
    return this.status;
  }

  getPriority(): TaskPriority {
    return this.priority;
  }

  getDueDate(): Date | null {
    return this.dueDate;
  }

  getAssigneeId(): string | null {
    return this.assigneeId;
  }
}
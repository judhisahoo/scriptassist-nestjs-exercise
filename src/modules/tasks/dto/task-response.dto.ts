import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

/**
 * Data Transfer Object for Task API responses
 * Defines the standardized structure of task data returned by all task-related endpoints
 *
 * This DTO ensures consistent API responses across all task operations (create, read, update).
 * It includes all relevant task information while maintaining security by excluding sensitive data.
 * The structure is optimized for frontend consumption and API documentation.
 *
 * Response includes:
 * - Core task information (id, title, description, status, priority)
 * - Temporal data (due date, creation/update timestamps)
 * - Ownership information (user assignment)
 * - Audit trail (creation and modification dates)
 */
export class TaskResponseDto {
  /** Unique identifier for the task */
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique UUID identifier for the task'
  })
  id: string;

  /** Task title */
  @ApiProperty({
    example: 'Complete project documentation',
    description: 'Brief title describing the task'
  })
  title: string;

  /** Detailed task description */
  @ApiProperty({
    example: 'Add details about API endpoints and data models',
    description: 'Detailed description of what needs to be done',
    required: false
  })
  description: string;

  /** Current status of the task */
  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.PENDING,
    description: 'Current status of the task'
  })
  status: TaskStatus;

  /** Priority level of the task */
  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
    description: 'Priority level indicating task importance'
  })
  priority: TaskPriority;

  /** Due date for task completion */
  @ApiProperty({
    example: '2023-12-31T23:59:59Z',
    description: 'ISO 8601 formatted due date',
    required: false
  })
  dueDate: Date;

  /** ID of the user who owns this task */
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'UUID of the user who created/owns the task'
  })
  userId: string;

  /** Timestamp when the task was created */
  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'ISO 8601 timestamp of task creation'
  })
  createdAt: Date;

  /** Timestamp when the task was last updated */
  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'ISO 8601 timestamp of last task modification'
  })
  updatedAt: Date;
}

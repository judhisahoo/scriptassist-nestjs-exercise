import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { Exclude } from 'class-transformer';

/**
 * Data Transfer Object for updating existing tasks
 * Supports partial updates where only provided fields are modified
 *
 * This DTO defines the structure for task update operations, allowing clients
 * to modify specific task properties without affecting others. It includes
 * security measures to prevent unauthorized field modifications and provides
 * comprehensive validation and API documentation.
 *
 * Key features:
 * - All fields are optional (partial update support)
 * - Security exclusions for immutable fields (id, userId)
 * - Comprehensive validation with class-validator
 * - Swagger API documentation for all fields
 * - Type-safe enum validation
 */
export class UpdateTaskDto {
  /** Excluded from input - set automatically */
  @Exclude()
  id?: string;

  /** Excluded from input - cannot be changed via update */
  @Exclude()
  userId?: string;

  /** Updated task title */
  @ApiProperty({
    example: 'Complete project documentation',
    description: 'Updated title for the task',
    required: false,
    minLength: 1,
    maxLength: 255
  })
  @IsString()
  @IsOptional()
  title?: string;

  /** Updated task description */
  @ApiProperty({
    example: 'Add details about API endpoints',
    description: 'Updated detailed description',
    required: false,
    maxLength: 1000
  })
  @IsString()
  @IsOptional()
  description?: string;

  /** Updated task status */
  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.IN_PROGRESS,
    description: 'New status for the task',
    required: false
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  /** Updated task priority */
  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
    description: 'New priority level for the task',
    required: false
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  /** Updated due date */
  @ApiProperty({
    example: '2025-12-31T23:59:59.000Z',
    description: 'Updated due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.SSSZ)',
    required: false,
    format: 'date-time'
  })
  @IsDateString({ strict: true })
  @IsOptional()
  dueDate?: string;
}

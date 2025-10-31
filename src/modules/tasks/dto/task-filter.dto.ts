import { IsEnum, IsOptional, IsString, IsUUID, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { Transform, Type } from 'class-transformer';

/**
 * Data Transfer Object for task filtering and search operations
 * Defines the structure for complex task queries with multiple filter criteria
 *
 * This DTO supports advanced filtering capabilities for task listings,
 * allowing users to narrow down tasks by various criteria. It includes
 * validation, transformation, and comprehensive API documentation.
 *
 * Supported filter criteria:
 * - Task status (PENDING, IN_PROGRESS, COMPLETED, OVERDUE)
 * - Task priority (LOW, MEDIUM, HIGH)
 * - User assignment (specific user or unassigned tasks)
 * - Text search across title and description
 * - Date range filtering for creation and due dates
 * - Pagination parameters
 */
export class TaskFilterDto {
  /**
   * Filter tasks by their current status
   * Optional - if not provided, tasks of all statuses will be included
   */
  @ApiProperty({
    enum: TaskStatus,
    description: 'Filter tasks by their current status',
    required: false,
    example: TaskStatus.IN_PROGRESS,
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  /**
   * Filter tasks by their priority level
   * Optional - if not provided, tasks of all priorities will be included
   */
  @ApiProperty({
    enum: TaskPriority,
    description: 'Filter tasks by their priority level',
    required: false,
    example: TaskPriority.HIGH,
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  /**
   * Filter tasks assigned to a specific user
   * Use 'unassigned' to find tasks with no assignee
   * Optional - if not provided, tasks for all users will be included
   */
  @ApiProperty({
    description: 'Filter tasks by assigned user UUID or "unassigned" for tasks with no assignee',
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value === 'unassigned' ? null : value)
  assigneeId?: string | null;

  /**
   * Search text to filter tasks by title or description
   * Performs case-insensitive partial matching
   * Optional - if not provided, no text filtering will be applied
   */
  @ApiProperty({
    description: 'Search text for filtering tasks by title or description (case-insensitive)',
    required: false,
    example: 'documentation',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  search?: string;

  /**
   * Filter tasks created after this date
   * ISO 8601 date string format
   * Optional - if not provided, no creation date filtering will be applied
   */
  @ApiProperty({
    description: 'Filter tasks created after this date (ISO 8601 format)',
    required: false,
    example: '2023-01-01T00:00:00.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  createdAfter?: string;

  /**
   * Filter tasks created before this date
   * ISO 8601 date string format
   * Optional - if not provided, no creation date filtering will be applied
   */
  @ApiProperty({
    description: 'Filter tasks created before this date (ISO 8601 format)',
    required: false,
    example: '2023-12-31T23:59:59.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  createdBefore?: string;

  /**
   * Filter tasks due after this date
   * ISO 8601 date string format
   * Optional - if not provided, no due date filtering will be applied
   */
  @ApiProperty({
    description: 'Filter tasks due after this date (ISO 8601 format)',
    required: false,
    example: '2023-06-01T00:00:00.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  dueAfter?: string;

  /**
   * Filter tasks due before this date
   * ISO 8601 date string format
   * Optional - if not provided, no due date filtering will be applied
   */
  @ApiProperty({
    description: 'Filter tasks due before this date (ISO 8601 format)',
    required: false,
    example: '2023-12-31T23:59:59.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  dueBefore?: string;

  /**
   * Page number for pagination (1-based)
   * Must be a positive integer
   * Optional - defaults to 1 if not provided
   */
  @ApiProperty({
    description: 'Page number for pagination (1-based)',
    required: false,
    example: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @Min(1)
  page?: number = 1;

  /**
   * Number of items per page
   * Must be between 1 and 100
   * Optional - defaults to 10 if not provided
   */
  @ApiProperty({
    description: 'Number of items per page (1-100)',
    required: false,
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  /**
   * Sort field for ordering results
   * Supported values: createdAt, updatedAt, dueDate, priority, status
   * Optional - defaults to 'createdAt' if not provided
   */
  @ApiProperty({
    description: 'Field to sort by (createdAt, updatedAt, dueDate, priority, status)',
    required: false,
    example: 'createdAt',
    enum: ['createdAt', 'updatedAt', 'dueDate', 'priority', 'status'],
  })
  @IsString()
  @IsOptional()
  sortBy?: 'createdAt' | 'updatedAt' | 'dueDate' | 'priority' | 'status' = 'createdAt';

  /**
   * Sort direction
   * Either 'asc' for ascending or 'desc' for descending
   * Optional - defaults to 'desc' if not provided
   */
  @ApiProperty({
    description: 'Sort direction (asc or desc)',
    required: false,
    example: 'desc',
    enum: ['asc', 'desc'],
  })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

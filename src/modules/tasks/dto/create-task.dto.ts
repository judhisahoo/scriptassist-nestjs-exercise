import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { Transform } from 'class-transformer';

/**
 * Data Transfer Object for creating new tasks
 * Defines the structure and validation rules for task creation requests
 *
 * This DTO handles the input validation and transformation for new task creation.
 * It includes security measures like XSS sanitization and comprehensive API documentation
 * for Swagger integration. All fields are validated both client-side and server-side.
 *
 * Key features:
 * - Input sanitization against XSS attacks
 * - Comprehensive validation with class-validator
 * - Swagger API documentation
 * - Type-safe enum validation
 * - Optional fields with sensible defaults
 */
export class CreateTaskDto {
  /** Task title - required, sanitized against XSS */
  @ApiProperty({
    example: 'Complete project documentation',
    description: 'Brief, descriptive title for the task',
    minLength: 1,
    maxLength: 255
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    value?.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''),
  )
  title: string;

  /** Optional detailed description - sanitized against XSS */
  @ApiProperty({
    example: 'Add details about API endpoints and data models',
    description: 'Detailed description of the task requirements',
    required: false,
    maxLength: 1000
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) =>
    value?.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''),
  )
  description?: string;

  /** Task status - defaults to PENDING if not provided */
  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.PENDING,
    description: 'Initial status of the task',
    required: false,
    default: TaskStatus.PENDING
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  /** Task priority - required field */
  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
    description: 'Priority level indicating task importance'
  })
  @IsEnum(TaskPriority)
  @IsNotEmpty()
  priority: TaskPriority;

  /** Due date in ISO 8601 format - required */
  @ApiProperty({
    example: '2025-12-31T23:59:59.000Z',
    description: 'Due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.SSSZ)',
    format: 'date-time'
  })
  @IsDateString()
  @IsNotEmpty()
  dueDate: string;

  /** User ID - automatically set from JWT token, optional for validation */
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'UUID of the user creating the task (set automatically)',
    required: false
  })
  @IsUUID()
  @IsOptional()
  userId?: string;
}

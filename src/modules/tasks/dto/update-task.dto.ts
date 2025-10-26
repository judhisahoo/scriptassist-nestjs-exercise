import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';
import { Exclude } from 'class-transformer';

export class UpdateTaskDto {
  @Exclude()
  id?: string;

  @Exclude()
  userId?: string;
  @ApiProperty({ example: 'Complete project documentation', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ example: 'Add details about API endpoints', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: TaskStatus, example: TaskStatus.IN_PROGRESS, required: false })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiProperty({ enum: TaskPriority, example: TaskPriority.MEDIUM, required: false })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

@ApiProperty({
    example: '2025-12-31T23:59:59.000Z',
    required: false,
    description: 'Due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.SSSZ)',
  })
  @IsDateString({ strict: true })
  @IsOptional()
  dueDate?: string;
} 
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TaskApplicationService } from './application/task.application.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { Task } from './entities/task.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Response DTO for paginated task lists
 */
interface TasksResponseDto {
  /** Array of task objects */
  data: Task[];
  /** Total number of tasks matching the query */
  count: number;
  /** Current page number */
  page: number;
  /** Number of items per page */
  limit: number;
}

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly taskService: TaskApplicationService) {}

  /**
   * Create a new task for the authenticated user
   * @param createTaskDto - Task creation data
   * @param user - Current authenticated user from JWT token
   */
  @Post()
  @ApiOperation({
    summary: 'Create a new task',
    description: 'Creates a new task with validation and associates it with the current user'
  })
  async create(@Body() createTaskDto: CreateTaskDto, @CurrentUser() user: any): Promise<void> {
    createTaskDto.userId = user.id;
    await this.taskService.createTask(createTaskDto);
  }

  /**
   * Retrieve paginated list of tasks with optional filtering
   * @param status - Filter by task status
   * @param priority - Filter by task priority
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 10)
   * @param search - Search in title and description
   * @returns Paginated task list
   */
  @Get()
  @ApiOperation({
    summary: 'Find all tasks with optional filtering',
    description: 'Retrieves a paginated list of tasks with support for filtering by status, priority, and full-text search'
  })
  @ApiQuery({ name: 'status', required: false, enum: TaskStatus, description: 'Filter by task status' })
  @ApiQuery({ name: 'priority', required: false, enum: TaskPriority, description: 'Filter by task priority' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page', example: 10 })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search in title and description' })
  async findAll(
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
  ): Promise<TasksResponseDto> {
    const result = await this.taskService.getTasks(status, priority, page, limit, search);

    return {
      data: result.items,
      count: result.total,
      page,
      limit,
    };
  }

  /**
   * Retrieve a specific task by its ID
   * @param id - Task UUID
   * @returns Task object or 404 if not found
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Find a task by ID',
    description: 'Retrieves a single task by its unique identifier'
  })
  async findOne(@Param('id') id: string): Promise<Task | null> {
    const task = await this.taskService.getTaskById(id);
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  /**
   * Update an existing task with partial data
   * @param id - Task UUID to update
   * @param updateTaskDto - Partial task data for update
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a task',
    description: 'Updates a task with partial data. Only provided fields will be updated.'
  })
  async update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto): Promise<void> {
    // Only pass the DTO object - validation will handle field filtering
    await this.taskService.updateTask(id, updateTaskDto);
  }

  /**
   * Mark a task as completed
   * @param id - Task UUID to complete
   */
  @Patch(':id/complete')
  @ApiOperation({
    summary: 'Complete a task',
    description: 'Marks a task as completed by updating its status'
  })
  async complete(@Param('id') id: string): Promise<void> {
    await this.taskService.completeTask(id);
  }

  /**
   * Soft delete a task by marking it as completed
   * @param id - Task UUID to delete
   * @note Currently implemented as soft delete (mark as completed)
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a task',
    description: 'Soft deletes a task by marking it as completed. Full delete functionality to be implemented.'
  })
  async remove(@Param('id') id: string): Promise<void> {
    const task = await this.taskService.getTaskById(id);
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    // Use the complete task functionality until delete is implemented
    await this.taskService.completeTask(id);
  }
}

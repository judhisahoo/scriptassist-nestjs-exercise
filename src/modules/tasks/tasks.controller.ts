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

interface TasksResponseDto {
  data: Task[];
  count: number;
  page: number;
  limit: number;
}

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly taskService: TaskApplicationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async create(@Body() createTaskDto: CreateTaskDto, @CurrentUser() user: any): Promise<void> {
    createTaskDto.userId = user.id;
    await this.taskService.createTask(createTaskDto);
  }

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering' })
  @ApiQuery({ name: 'status', required: false, enum: TaskStatus })
  @ApiQuery({ name: 'priority', required: false, enum: TaskPriority })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
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

  @Get(':id')
  @ApiOperation({ summary: 'Find a task by ID' })
  async findOne(@Param('id') id: string): Promise<Task | null> {
    const task = await this.taskService.getTaskById(id);
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  async update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto): Promise<void> {
    // Only pass the DTO object - validation will handle field filtering
    await this.taskService.updateTask(id, updateTaskDto);
    await this.taskService.updateTask(id, updateTaskDto);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Complete a task' })
  async complete(@Param('id') id: string): Promise<void> {
    await this.taskService.completeTask(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  async remove(@Param('id') id: string): Promise<void> {
    const task = await this.taskService.getTaskById(id);
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    // Use the complete task functionality until delete is implemented
    await this.taskService.completeTask(id);
  }
}

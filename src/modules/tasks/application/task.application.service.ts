import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CreateTaskCommand,
  UpdateTaskCommand,
  CompleteTaskCommand,
} from './commands/task.commands';
import { GetTaskByIdQuery, GetTasksQuery, GetTasksByAssigneeQuery } from './queries/task.queries';
import { Task } from '../entities/task.entity';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { TaskStatus } from '../enums/task-status.enum';

/**
 * Application Service for Task operations
 * Acts as the entry point for task-related business operations
 * Implements CQRS pattern by dispatching commands and queries
 *
 * This service serves as the application layer in Clean Architecture,
 * orchestrating business operations while maintaining separation of concerns.
 * It translates DTOs from the presentation layer into domain commands/queries
 * and handles the coordination between different parts of the system.
 *
 * Key responsibilities:
 * - Command dispatching for write operations (create, update, complete)
 * - Query dispatching for read operations (find, list, search)
 * - Input validation and transformation
 * - Error handling and logging
 * - Business rule enforcement at application level
 */
@Injectable()
export class TaskApplicationService {
  /** Logger instance for application-level logging */
  private readonly logger = new Logger(TaskApplicationService.name);

  /**
   * Constructor for TaskApplicationService
   * Injects CQRS buses for command and query handling
   *
   * @param commandBus - CQRS command bus for dispatching write operations
   * @param queryBus - CQRS query bus for dispatching read operations
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Creates a new task using the CQRS command pattern
   *
   * This method handles the creation of new tasks by:
   * 1. Transforming the DTO into a domain command
   * 2. Dispatching the command through the CQRS command bus
   * 3. Letting the command handler perform the actual business logic
   *
   * @param dto - Task creation data from the API layer
   * @throws Error if command execution fails
   */
  async createTask(dto: CreateTaskDto): Promise<void> {
    try {
      this.logger.debug(`Creating task: ${dto.title}`);

      // Transform DTO to command with proper null handling
      const command = new CreateTaskCommand(
        dto.title,
        dto.description || '', // Default empty string for description
        dto.priority,
        dto.dueDate,
        dto.userId ?? null, // Convert undefined to null for assignee
      );

      // Dispatch command through CQRS bus
      await this.commandBus.execute(command);

      this.logger.debug(`Task creation command dispatched for: ${dto.title}`);
    } catch (error) {
      this.logger.error(`Failed to create task: ${dto.title}`, error);
      throw error;
    }
  }

  /**
   * Updates an existing task with partial data
   *
   * This method supports partial updates where only provided fields
   * are modified. It extracts the relevant fields from the DTO and
   * dispatches an update command through the CQRS bus.
   *
   * @param id - Task UUID to update
   * @param dto - Partial update data (only provided fields will be updated)
   * @throws Error if command execution fails or task not found
   */
  async updateTask(id: string, dto: UpdateTaskDto): Promise<void> {
    try {
      this.logger.debug(`Updating task: ${id}`);

      // Extract only the allowed fields for update (destructuring for clarity)
      const { priority, title, description, status, dueDate } = dto;

      // Create update command with extracted fields
      const command = new UpdateTaskCommand(id, title, description, status, priority, dueDate);

      // Dispatch command through CQRS bus
      await this.commandBus.execute(command);

      this.logger.debug(`Task update command dispatched for: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to update task: ${id}`, error);
      throw error;
    }
  }

  /**
   * Marks a task as completed
   *
   * This method changes the task status to COMPLETED. The actual
   * business logic validation (e.g., preventing completion of already
   * completed tasks) is handled by the domain aggregate.
   *
   * @param id - Task UUID to complete
   * @throws Error if command execution fails or business rules violated
   */
  async completeTask(id: string): Promise<void> {
    try {
      this.logger.debug(`Completing task: ${id}`);

      // Create completion command
      const command = new CompleteTaskCommand(id);

      // Dispatch command through CQRS bus
      await this.commandBus.execute(command);

      this.logger.debug(`Task completion command dispatched for: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to complete task: ${id}`, error);
      throw error;
    }
  }

  /**
   * Retrieves a single task by ID
   *
   * This read operation uses the CQRS query pattern to fetch
   * a specific task. The query is dispatched through the query bus
   * and handled by the appropriate query handler.
   *
   * @param id - Task UUID
   * @returns Task entity or null if not found
   * @throws Error if query execution fails
   */
  async getTaskById(id: string): Promise<Task | null> {
    try {
      this.logger.debug(`Retrieving task by ID: ${id}`);

      // Execute query through CQRS query bus
      const result = await this.queryBus.execute(new GetTaskByIdQuery(id));

      this.logger.debug(`Task retrieval completed for ID: ${id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to retrieve task: ${id}`, error);
      throw error;
    }
  }

  /**
   * Retrieves paginated list of tasks with optional filtering
   *
   * This method supports complex querying with multiple filter options:
   * - Status filtering (PENDING, IN_PROGRESS, COMPLETED, OVERDUE)
   * - Priority filtering (LOW, MEDIUM, HIGH)
   * - Full-text search across title and description
   * - Pagination with configurable page size
   *
   * @param status - Filter by task status (optional)
   * @param priority - Filter by task priority (optional)
   * @param page - Page number for pagination (optional, defaults to 1)
   * @param limit - Number of items per page (optional, defaults to 10)
   * @param search - Search text for title/description (optional)
   * @returns Object containing items array and total count for pagination
   * @throws Error if query execution fails
   */
  async getTasks(
    status?: TaskStatus,
    priority?: string,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ items: Task[]; total: number }> {
    try {
      this.logger.debug(`Retrieving tasks with filters - status: ${status}, priority: ${priority}, search: ${search}`);

      // Execute query through CQRS query bus
      const result = await this.queryBus.execute(new GetTasksQuery(status, priority, page, limit, search));

      this.logger.debug(`Task list retrieval completed - found ${result.total} tasks`);
      return result;
    } catch (error) {
      this.logger.error('Failed to retrieve task list', error);
      throw error;
    }
  }

  /**
   * Retrieves tasks assigned to a specific user
   *
   * This method supports user-specific task listings by filtering
   * tasks by assignee. Passing null as assigneeId returns unassigned tasks.
   * Optional status filtering can be applied on top of assignee filtering.
   *
   * @param assigneeId - User UUID or null for unassigned tasks
   * @param status - Optional status filter to apply with assignee filter
   * @returns Array of Task entities assigned to the specified user
   * @throws Error if query execution fails
   */
  async getTasksByAssignee(assigneeId: string | null, status?: TaskStatus): Promise<Task[]> {
    try {
      this.logger.debug(`Retrieving tasks for assignee: ${assigneeId}, status: ${status}`);

      // Execute query through CQRS query bus
      const result = await this.queryBus.execute(new GetTasksByAssigneeQuery(assigneeId, status));

      this.logger.debug(`Assignee task retrieval completed - found ${result.length} tasks`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to retrieve tasks for assignee: ${assigneeId}`, error);
      throw error;
    }
  }
}

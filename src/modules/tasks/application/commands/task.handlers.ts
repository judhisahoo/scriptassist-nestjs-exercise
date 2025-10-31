import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateTaskCommand, UpdateTaskCommand, CompleteTaskCommand } from './task.commands';
import { TaskRepository } from '../../infrastructure/task.repository';
import { TaskAggregate } from '../../domain/task.aggregate';
import { v4 as uuidv4 } from 'uuid';
import { TaskPriority } from '../../enums/task-priority.enum';
import { TaskStatus } from '../../enums/task-status.enum';
import { Logger } from '@nestjs/common';

/**
 * CQRS Command Handler for creating new tasks
 * Handles the CreateTaskCommand and orchestrates task creation
 *
 * This handler is responsible for:
 * - Generating unique task IDs
 * - Creating domain aggregates with business logic
 * - Persisting tasks to the repository
 * - Logging successful operations
 * - Handling and propagating errors
 *
 * @remarks
 * - Uses UUID v4 for globally unique task identifiers
 * - Applies domain events during task creation
 * - Ensures transactional consistency with the repository
 */
@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand> {
  /** Logger instance for command handler logging */
  private readonly logger = new Logger(CreateTaskHandler.name);

  /**
   * Constructor for CreateTaskHandler
   * @param taskRepository - Repository for task persistence operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the task creation command
   *
   * This method performs the following steps:
   * 1. Generates a unique UUID for the new task
   * 2. Creates a domain aggregate with the provided data
   * 3. Applies business logic through the domain model
   * 4. Persists the task to the repository
   * 5. Logs the successful operation
   *
   * @param command - The create task command containing all task details
   * @throws Error if task creation fails (validation, persistence, etc.)
   */
  async execute(command: CreateTaskCommand): Promise<void> {
    try {
      // Generate unique task ID using UUID v4
      const taskId = uuidv4();

      // Create domain aggregate with generated ID
      const task = new TaskAggregate(taskId);

      // Apply business logic through domain model
      // Convert string priority to enum and parse date
      task.createTask(
        command.title,
        command.description,
        command.priority as TaskPriority, // Type assertion after validation
        command.dueDate ? new Date(command.dueDate) : null,
        command.assigneeId,
      );

      // Persist the task to the repository (handles transactions)
      await this.taskRepository.save(task);

      // Log successful operation with task ID for traceability
      this.logger.log(`Task created successfully: ${taskId}`);
    } catch (error) {
      // Log error with full context for debugging
      this.logger.error(
        `Failed to create task: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Re-throw to propagate error up the chain
      throw error;
    }
  }
}

/**
 * CQRS Command Handler for updating existing tasks
 * Handles the UpdateTaskCommand and orchestrates task updates
 *
 * This handler is responsible for:
 * - Retrieving existing tasks from the repository
 * - Converting string-based enums to typed enums for type safety
 * - Applying partial updates through the domain model
 * - Persisting changes with transactional consistency
 * - Logging successful operations and handling errors
 *
 * @remarks
 * - Supports partial updates (only provided fields are changed)
 * - Validates task existence before attempting updates
 * - Converts command strings to domain enums for type safety
 * - Ensures domain invariants are maintained during updates
 */
@CommandHandler(UpdateTaskCommand)
export class UpdateTaskHandler implements ICommandHandler<UpdateTaskCommand> {
  /** Logger instance for command handler logging */
  private readonly logger = new Logger(UpdateTaskHandler.name);

  /**
   * Constructor for UpdateTaskHandler
   * @param taskRepository - Repository for task persistence operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the task update command
   *
   * This method performs the following steps:
   * 1. Retrieves the existing task from the repository
   * 2. Validates that the task exists
   * 3. Converts string-based enums to typed enums for type safety
   * 4. Applies partial updates through the domain model
   * 5. Persists changes with transactional consistency
   * 6. Logs the successful operation
   *
   * @param command - The update task command with partial task details
   * @throws Error if task update fails (task not found, validation error, persistence error)
   */
  async execute(command: UpdateTaskCommand): Promise<void> {
    try {
      // Retrieve existing task from repository
      const task = await this.taskRepository.findById(command.id);
      if (!task) {
        throw new Error('Task not found');
      }

      // Convert string enums to typed enum values for type safety
      // This ensures domain model receives properly typed values
      const status = command.status
        ? TaskStatus[command.status as keyof typeof TaskStatus]
        : undefined;
      const priority = command.priority
        ? TaskPriority[command.priority as keyof typeof TaskPriority]
        : undefined;

      // Apply partial updates through domain model
      // Domain logic handles validation and business rules
      task.updateTask(
        command.title,
        command.description,
        status,
        priority,
        command.dueDate ? new Date(command.dueDate) : null,
      );

      // Persist changes to repository (handles transactions)
      await this.taskRepository.save(task);

      // Log successful operation with task ID for traceability
      this.logger.log(`Task updated successfully: ${command.id}`);
    } catch (error) {
      // Log error with full context for debugging
      this.logger.error(
        `Failed to update task ${command.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Re-throw to propagate error up the chain
      throw error;
    }
  }
}

/**
 * CQRS Command Handler for completing tasks
 * Handles the CompleteTaskCommand and marks tasks as completed
 *
 * This handler is responsible for:
 * - Retrieving tasks for completion
 * - Validating task existence and completion eligibility
 * - Executing domain completion logic
 * - Persisting completion state changes
 * - Logging completion operations
 *
 * @remarks
 * - Domain model prevents completing already completed tasks
 * - Triggers completion-specific domain events
 * - Ensures state transition validity
 * - Maintains audit trail of completions
 */
@CommandHandler(CompleteTaskCommand)
export class CompleteTaskHandler implements ICommandHandler<CompleteTaskCommand> {
  /** Logger instance for command handler logging */
  private readonly logger = new Logger(CompleteTaskHandler.name);

  /**
   * Constructor for CompleteTaskHandler
   * @param taskRepository - Repository for task persistence operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the task completion command
   *
   * This method performs the following steps:
   * 1. Retrieves the task to be completed from the repository
   * 2. Validates that the task exists
   * 3. Applies completion logic through the domain model
   * 4. Persists the completion state change
   * 5. Logs the successful completion operation
   *
   * @param command - The complete task command containing the task ID
   * @throws Error if task completion fails (task not found, already completed, persistence error)
   */
  async execute(command: CompleteTaskCommand): Promise<void> {
    try {
      // Retrieve task from repository for completion
      const task = await this.taskRepository.findById(command.id);
      if (!task) {
        throw new Error('Task not found');
      }

      // Apply completion logic through domain model
      // Domain handles validation (e.g., preventing double completion)
      task.completeTask();

      // Persist the completion state change (handles transactions)
      await this.taskRepository.save(task);

      // Log successful completion for audit purposes
      this.logger.log(`Task completed successfully: ${command.id}`);
    } catch (error) {
      // Log error with full context for debugging
      this.logger.error(
        `Failed to complete task ${command.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Re-throw to propagate error up the chain
      throw error;
    }
  }
}

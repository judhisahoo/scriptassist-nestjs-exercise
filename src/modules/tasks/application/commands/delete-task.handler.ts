import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TaskRepository } from '../../infrastructure/task.repository';
import { Logger } from '@nestjs/common';

/**
 * Command to delete an existing task
 * Represents a permanent removal operation in the CQRS pattern
 *
 * This command encapsulates the intent to permanently delete a task
 * from the system. Unlike soft deletes, this represents complete
 * removal of the task entity.
 *
 * @remarks
 * - This is a destructive operation that cannot be undone
 * - Command handler validates task existence before deletion
 * - May trigger cleanup operations or audit logging
 */
export class DeleteTaskCommand {
  /**
   * Creates a new task deletion command
   *
   * @param id - Task UUID to permanently delete (required, must exist)
   */
  constructor(public readonly id: string) {}
}

/**
 * CQRS Command Handler for deleting tasks
 * Handles the DeleteTaskCommand and orchestrates task deletion
 *
 * This handler is responsible for:
 * - Validating task existence before deletion
 * - Executing the deletion through the repository
 * - Ensuring proper error handling and logging
 * - Maintaining data consistency during deletion
 *
 * @remarks
 * - Performs existence check before deletion
 * - Handles transactional deletion operations
 * - Logs deletion operations for audit purposes
 * - Propagates errors appropriately
 */
@CommandHandler(DeleteTaskCommand)
export class DeleteTaskHandler implements ICommandHandler<DeleteTaskCommand> {
  /** Logger instance for command handler logging */
  private readonly logger = new Logger(DeleteTaskHandler.name);

  /**
   * Constructor for DeleteTaskHandler
   * @param taskRepository - Repository for task persistence operations
   */
  constructor(private readonly taskRepository: TaskRepository) {}

  /**
   * Executes the task deletion command
   *
   * This method performs the following steps:
   * 1. Validates that the task exists before deletion
   * 2. Executes the deletion through the repository
   * 3. Logs the successful deletion operation
   *
   * @param command - The delete task command containing the task ID
   * @throws Error if task deletion fails (task not found, persistence error, etc.)
   */
  async execute(command: DeleteTaskCommand): Promise<void> {
    try {
      // Validate task existence before deletion
      const task = await this.taskRepository.findById(command.id);
      if (!task) {
        throw new Error('Task not found');
      }

      // Execute deletion through repository (handles transactions)
      await this.taskRepository.delete(command.id);

      // Log successful deletion for audit purposes
      this.logger.log(`Task deleted successfully: ${command.id}`);
    } catch (error) {
      // Log error with full context for debugging
      this.logger.error(
        `Failed to delete task ${command.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Re-throw to propagate error up the chain
      throw error;
    }
  }
}

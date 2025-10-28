import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TaskRepository } from '../../infrastructure/task.repository';

export class DeleteTaskCommand {
  constructor(public readonly id: string) {}
}

@CommandHandler(DeleteTaskCommand)
export class DeleteTaskHandler implements ICommandHandler<DeleteTaskCommand> {
  constructor(private readonly taskRepository: TaskRepository) {}

  async execute(command: DeleteTaskCommand): Promise<void> {
    const task = await this.taskRepository.findById(command.id);
    if (!task) {
      throw new Error('Task not found');
    }

    await this.taskRepository.delete(command.id);
  }
}

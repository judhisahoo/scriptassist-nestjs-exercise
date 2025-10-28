import { TaskAggregate } from '../domain/task.aggregate';
import { Task } from '../entities/task.entity';

export interface ITaskRepository {
  save(task: TaskAggregate): Promise<void>;
  findById(id: string): Promise<TaskAggregate | null>;
  findTasks(
    status?: string,
    priority?: string,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ items: Task[]; total: number }>;
  findByAssignee(userId: string, status?: string): Promise<Task[]>;
  delete(id: string): Promise<void>;
}

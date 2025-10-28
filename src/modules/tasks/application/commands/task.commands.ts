export class CreateTaskCommand {
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly priority: string,
    public readonly dueDate: string | null,
    public readonly assigneeId: string | null,
  ) {}
}

export class UpdateTaskCommand {
  constructor(
    public readonly id: string,
    public readonly title?: string,
    public readonly description?: string,
    public readonly status?: string,
    public readonly priority?: string,
    public readonly dueDate?: string | null,
  ) {}
}

export class CompleteTaskCommand {
  constructor(public readonly id: string) {}
}

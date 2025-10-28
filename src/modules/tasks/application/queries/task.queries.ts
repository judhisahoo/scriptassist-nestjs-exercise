export class GetTaskByIdQuery {
  constructor(public readonly id: string) {}
}

export class GetTasksQuery {
  constructor(
    public readonly status?: string,
    public readonly priority?: string,
    public readonly page?: number,
    public readonly limit?: number,
    public readonly search?: string,
  ) {}
}

export class GetTasksByAssigneeQuery {
  constructor(
    public readonly userId: string | null,
    public readonly status?: string,
  ) {}
}

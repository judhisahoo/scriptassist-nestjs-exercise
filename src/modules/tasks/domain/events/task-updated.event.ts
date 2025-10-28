export class TaskUpdatedEvent {
  constructor(
    public readonly taskId: string,
    public readonly title: string,
    public readonly assigneeId: string | null,
  ) {}
}

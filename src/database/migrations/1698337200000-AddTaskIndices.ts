import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddTaskIndices1698337200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add index for status queries and stats aggregation
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'IDX_TASKS_STATUS',
        columnNames: ['status'],
      })
    );

    // Add index for priority filtering
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'IDX_TASKS_PRIORITY',
        columnNames: ['priority'],
      })
    );

    // Add index for due date queries (overdue tasks)
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'IDX_TASKS_DUE_DATE',
        columnNames: ['due_date'],
      })
    );

    // Add composite index for status + due date (commonly queried together)
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'IDX_TASKS_STATUS_DUE_DATE',
        columnNames: ['status', 'due_date'],
      })
    );

    // Add index for text search
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'IDX_TASKS_TITLE_DESC',
        columnNames: ['title', 'description'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('tasks', 'IDX_TASKS_STATUS');
    await queryRunner.dropIndex('tasks', 'IDX_TASKS_PRIORITY');
    await queryRunner.dropIndex('tasks', 'IDX_TASKS_DUE_DATE');
    await queryRunner.dropIndex('tasks', 'IDX_TASKS_STATUS_DUE_DATE');
    await queryRunner.dropIndex('tasks', 'IDX_TASKS_TITLE_DESC');
  }
}
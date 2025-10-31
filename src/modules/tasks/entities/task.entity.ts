import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

/**
 * TypeORM entity representing a Task in the database
 * Maps to the 'tasks' table with proper relationships and constraints
 *
 * This entity defines the database schema for tasks, including:
 * - Primary key generation using UUID
 * - Enum-based status and priority fields
 * - Optional relationships and nullable fields
 * - Automatic timestamp management
 * - Foreign key relationships with User entity
 *
 * The entity serves as the data transfer object between the database
 * and the application layer, providing type safety and validation.
 */
@Entity('tasks')
export class Task {
  /**
   * Primary key - auto-generated UUID
   * Uses PostgreSQL UUID generation for globally unique identifiers
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Task title - required field
   * Stores the main heading/title of the task
   * Limited by database constraints for optimal performance
   */
  @Column()
  title: string;

  /**
   * Optional detailed description of the task
   * Uses TEXT type for unlimited length descriptions
   * Nullable to allow tasks without detailed descriptions
   */
  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * Current status of the task with default value
   * Uses enum type for data integrity and performance
   * Defaults to PENDING for new tasks
   */
  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  /**
   * Priority level of the task with default value
   * Uses enum type for controlled vocabulary
   * Defaults to MEDIUM priority for balanced task management
   */
  @Column({
    type: 'enum',
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  /**
   * Optional due date for task completion
   * Stored as timestamp for precise date/time handling
   * Nullable for tasks without specific deadlines
   * Uses custom column name for database consistency
   */
  @Column({ name: 'due_date', nullable: true, type: 'timestamp' })
  dueDate: Date | null;

  /**
   * Foreign key reference to the assigned user
   * Nullable for unassigned tasks (allows tasks to exist without owners)
   * Uses custom column name following database naming conventions
   * References User entity by UUID
   */
  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  /**
   * Many-to-one relationship with User entity
   * Enables lazy/eager loading of user information
   * Bidirectional relationship (User has many Tasks)
   * Uses explicit join column for clarity and performance
   */
  @ManyToOne('User', (user: User) => user.tasks)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Auto-generated creation timestamp
   * Automatically set when record is first created
   * Uses custom column name for consistency
   * Cannot be manually updated
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Auto-updated modification timestamp
   * Automatically updated on every record modification
   * Uses custom column name for consistency
   * Tracks the last time the task was changed
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

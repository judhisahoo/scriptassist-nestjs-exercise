import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Task } from '../../tasks/entities/task.entity';
import { Exclude } from 'class-transformer';

/**
 * TypeORM entity representing a User in the database
 * Maps to the 'users' table with authentication and task relationships
 */
@Entity('users')
export class User {
  /** Primary key - auto-generated UUID */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** User's email address - must be unique */
  @Column({ unique: true })
  email: string;

  /** User's display name */
  @Column()
  name: string;

  /** Hashed password - excluded from serialization */
  @Column()
  @Exclude({ toPlainOnly: true })
  password: string;

  /** JWT refresh token - excluded from serialization */
  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  refreshToken: string;

  /** User's role for authorization (defaults to 'user') */
  @Column({ default: 'user' })
  role: string;

  /** One-to-many relationship with Task entities */
  @OneToMany('Task', (task: Task) => task.user)
  tasks: Task[];

  /** Auto-generated creation timestamp */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Auto-updated modification timestamp */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

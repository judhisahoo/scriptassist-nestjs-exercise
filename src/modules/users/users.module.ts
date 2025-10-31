import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';

/**
 * Users module configuring user management functionality.
 * Provides complete user CRUD operations and authentication integration.
 *
 * @remarks
 * This module configures:
 * - TypeORM repository for User entity
 * - User service for business logic
 * - User controller for REST endpoints
 * - Integration with authentication module
 *
 * @example
 * ```typescript
 * // Module is automatically imported in AuthModule
 * // Provides user management for authentication operations
 * ```
 */
@Module({
  imports: [
    /** TypeORM feature module for User entity */
    TypeOrmModule.forFeature([User])
  ],

  /** Controllers providing user management endpoints */
  controllers: [UsersController],

  /** Services for user business logic */
  providers: [UsersService],

  /** Exported services for use in other modules */
  exports: [UsersService],
})
export class UsersModule {}

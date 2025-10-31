import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

/**
 * Users service handling user management operations.
 * Provides CRUD operations for user accounts with password hashing and validation.
 *
 * @remarks
 * This service provides:
 * - User creation with password hashing
 * - User retrieval by ID and email
 * - User updates with password re-hashing
 * - User deletion with existence checks
 * - Refresh token management for authentication
 */
@Injectable()
export class UsersService {
  /**
   * Creates an instance of UsersService.
   *
   * @param usersRepository - TypeORM repository for User entity operations
   */
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  /**
   * Creates a new user account with password hashing.
   * Validates input data and securely stores user credentials.
   *
   * @param createUserDto - User creation data containing email, name, and password
   * @returns Created user entity with sensitive data excluded by serialization
   * @throws BadRequestException for validation errors
   * @remarks
   * TODO: Add email uniqueness validation at database level
   * TODO: Implement password strength validation
   * TODO: Add user role assignment logic
   * TODO: Implement user profile initialization
   */
  async create(createUserDto: CreateUserDto): Promise<User> {
    // Hash password using bcrypt with salt rounds of 10
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Create user entity with hashed password
    const user = this.usersRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });

    // Save user to database
    return this.usersRepository.save(user);
  }

  /**
   * Retrieves all users from the database.
   * Returns array of users with sensitive data excluded by serialization.
   *
   * @returns Array of all user entities
   * @remarks
   * TODO: Add pagination support for large datasets
   * TODO: Implement filtering and sorting options
   * TODO: Add role-based access control
   * TODO: Consider caching for frequently accessed data
   */
  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  /**
   * Retrieves a single user by ID.
   * Throws NotFoundException if user doesn't exist.
   *
   * @param id - User UUID to retrieve
   * @returns User entity with sensitive data excluded
   * @throws NotFoundException if user not found
   * @remarks
   * TODO: Add user permission validation for access control
   * TODO: Implement user data caching
   * TODO: Add user activity tracking
   */
  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /**
   * Retrieves a user by email address.
   * Used for authentication and email uniqueness validation.
   *
   * @param email - User's email address
   * @returns User entity if found, null otherwise
   * @remarks
   * TODO: Add email normalization (lowercase, trim)
   * TODO: Implement email verification status checking
   * TODO: Add user status validation (active/inactive)
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  /**
   * Updates an existing user account.
   * Handles password re-hashing if password is being updated.
   *
   * @param id - User ID to update
   * @param updateUserDto - Partial user data for update
   * @returns Updated user entity with sensitive data excluded
   * @throws NotFoundException if user not found
   * @remarks
   * TODO: Add email change verification workflow
   * TODO: Implement audit logging for user changes
   * TODO: Add validation for email uniqueness on update
   * TODO: Implement partial update validation
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    // Verify user exists
    const user = await this.findOne(id);

    // Re-hash password if being updated
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Merge update data with existing user
    this.usersRepository.merge(user, updateUserDto);

    // Save updated user
    return this.usersRepository.save(user);
  }

  /**
   * Deletes a user account from the database.
   * Performs existence check before deletion.
   *
   * @param id - User ID to delete
   * @throws NotFoundException if user not found
   * @remarks
   * TODO: Implement soft delete instead of hard delete
   * TODO: Add cascade deletion handling for related entities
   * TODO: Implement user deletion confirmation workflow
   * TODO: Add GDPR compliance for data deletion
   * TODO: Implement audit logging for deletions
   */
  async remove(id: string): Promise<void> {
    // Verify user exists before deletion
    const user = await this.findOne(id);

    // Remove user from database
    await this.usersRepository.remove(user);
  }

  /**
   * Updates the refresh token for a user during authentication.
   * Used by AuthService for token rotation and logout.
   *
   * @param id - User ID to update
   * @param refreshToken - New refresh token or null to clear
   * @remarks
   * TODO: Add refresh token encryption for additional security
   * TODO: Implement refresh token expiration tracking
   * TODO: Add concurrent session management
   * TODO: Implement refresh token blacklisting
   */
  async updateRefreshToken(id: string, refreshToken: string | null): Promise<void> {
    await this.usersRepository.update(id, { refreshToken: refreshToken || undefined });
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ClassSerializerInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Users controller handling user management operations.
 * Provides REST endpoints for CRUD operations on user accounts.
 *
 * @remarks
 * This controller handles:
 * - User registration (public endpoint)
 * - User retrieval (protected endpoints)
 * - User updates (protected endpoints)
 * - User deletion (protected endpoints)
 * - Automatic serialization of sensitive data
 */
@ApiTags('users')
@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  /** Injected users service for business logic */
  constructor(private readonly usersService: UsersService) {}

  /**
   * Creates a new user account.
   * Public endpoint that doesn't require authentication.
   *
   * @param createUserDto - User creation data
   * @returns Created user object with sensitive data excluded
   * @throws BadRequestException for validation errors
   * @remarks
   * TODO: Add email verification workflow
   * TODO: Implement registration rate limiting
   * TODO: Send welcome email after registration
   */
  @Post()
  @ApiOperation({ summary: 'Create user', description: 'Create a new user account' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * Retrieves all users from the system.
   * Protected endpoint requiring authentication.
   *
   * @returns Array of all users with sensitive data excluded
   * @throws UnauthorizedException if not authenticated
   * @remarks
   * TODO: Add pagination support for large user lists
   * TODO: Implement filtering and sorting options
   * TODO: Add role-based access control for admin users only
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Get all users', description: 'Retrieve all users' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll() {
    return this.usersService.findAll();
  }

  /**
   * Retrieves a specific user by ID.
   * Protected endpoint requiring authentication.
   *
   * @param id - User ID to retrieve
   * @returns User object with sensitive data excluded
   * @throws NotFoundException if user not found
   * @throws UnauthorizedException if not authenticated
   * @remarks
   * TODO: Allow users to view their own profile without admin role
   * TODO: Implement user privacy settings
   * TODO: Add user activity tracking
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID', description: 'Retrieve a specific user' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  /**
   * Updates an existing user account.
   * Protected endpoint requiring authentication.
   *
   * @param id - User ID to update
   * @param updateUserDto - Partial user data for update
   * @returns Updated user object with sensitive data excluded
   * @throws NotFoundException if user not found
   * @throws UnauthorizedException if not authenticated
   * @remarks
   * TODO: Allow users to update their own profiles
   * TODO: Implement email change verification workflow
   * TODO: Add password change validation
   * TODO: Implement audit logging for user changes
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update user', description: 'Update an existing user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  /**
   * Deletes a user account.
   * Protected endpoint requiring authentication.
   *
   * @param id - User ID to delete
   * @throws NotFoundException if user not found
   * @throws UnauthorizedException if not authenticated
   * @remarks
   * TODO: Implement soft delete instead of hard delete
   * TODO: Add cascade deletion handling for related data
   * TODO: Implement user deletion confirmation workflow
   * TODO: Add GDPR compliance for data deletion
   * TODO: Implement audit logging for deletions
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete user', description: 'Delete a user account' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}

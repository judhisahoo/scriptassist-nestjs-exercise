import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Authentication controller handling user login, registration, and token refresh operations.
 * Provides REST endpoints for authentication-related functionality.
 *
 * @remarks
 * This controller handles:
 * - User registration with email validation
 * - User login with credential verification
 * - JWT token refresh for session management
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /** Injected authentication service for business logic */
  constructor(private readonly authService: AuthService) {}

  /**
   * Authenticates a user with email and password credentials.
   * Returns JWT access and refresh tokens upon successful authentication.
   *
   * @param loginDto - User login credentials
   * @returns Object containing access token, refresh token, and user information
   * @throws UnauthorizedException for invalid credentials
   * @remarks
   * TODO: Add rate limiting for login attempts
   * TODO: Implement account lockout after failed attempts
   * TODO: Add multi-factor authentication support
   * TODO: Implement login audit logging
   */
  @Post('login')
  @ApiOperation({ summary: 'User login', description: 'Authenticate user with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Registers a new user account with email, name, and password.
   * Performs email uniqueness validation and password hashing.
   *
   * @param registerDto - User registration data
   * @returns Object containing access token, refresh token, and user information
   * @throws UnauthorizedException if email already exists
   * @remarks
   * TODO: Add email verification workflow
   * TODO: Implement registration rate limiting
   * TODO: Add password strength validation
   * TODO: Send welcome email after registration
   */
  @Post('register')
  @ApiOperation({ summary: 'User registration', description: 'Create new user account' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 401, description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Refreshes JWT access token using a valid refresh token.
   * Implements token rotation for enhanced security.
   *
   * @param refreshDto - Refresh token data
   * @returns Object containing new access and refresh tokens
   * @throws UnauthorizedException for invalid or expired refresh tokens
   * @remarks
   * TODO: Implement refresh token blacklisting
   * TODO: Add refresh token usage tracking
   * TODO: Implement maximum refresh token lifetime
   * TODO: Add concurrent session limits
   */
  @Post('refresh')
  @ApiOperation({ summary: 'Token refresh', description: 'Refresh JWT access token' })
  @ApiResponse({ status: 200, description: 'Token refresh successful' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refresh(refreshDto.refreshToken);
  }
}

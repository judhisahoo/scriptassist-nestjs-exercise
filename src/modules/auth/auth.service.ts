import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';

/**
 * Authentication service handling user login, registration, token management, and validation.
 * Implements secure authentication with JWT tokens, password hashing, and refresh token rotation.
 *
 * @remarks
 * This service provides:
 * - User authentication with email/password
 * - JWT access and refresh token generation
 * - Password hashing and verification
 * - User registration with validation
 * - Token refresh and rotation
 * - User role validation
 */
@Injectable()
export class AuthService {
  /**
   * Creates an instance of AuthService.
   *
   * @param usersService - Service for user data operations
   * @param jwtService - Service for JWT token operations
   * @param configService - Service for accessing application configuration
   */
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Authenticates a user with email and password credentials.
   * Validates user existence, password correctness, and generates JWT tokens.
   *
   * @param loginDto - User login credentials containing email and password
   * @returns Object containing access token, refresh token, and sanitized user data
   * @throws UnauthorizedException for invalid credentials or non-existent users
   * @remarks
   * TODO: Implement account lockout after multiple failed attempts
   * TODO: Add login attempt rate limiting
   * TODO: Implement multi-factor authentication
   * TODO: Add login audit logging with IP tracking
   * TODO: Implement suspicious activity detection
   */
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email');
    }

    // Verify password using bcrypt
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    // Create JWT payload with user information
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    // Generate both access and refresh tokens
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    // Store refresh token in database for validation
    await this.usersService.updateRefreshToken(user.id, refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  /**
   * Registers a new user account with email uniqueness validation.
   * Creates user record, hashes password, and generates initial JWT tokens.
   *
   * @param registerDto - User registration data containing email, name, and password
   * @returns Object containing access token, refresh token, and complete user data
   * @throws UnauthorizedException if email already exists
   * @remarks
   * TODO: Add email verification workflow before account activation
   * TODO: Implement registration rate limiting
   * TODO: Add password strength validation and complexity requirements
   * TODO: Send welcome email and account verification email
   * TODO: Implement account activation requirement before login
   * TODO: Add GDPR compliance for user data collection
   */
  async register(registerDto: RegisterDto) {
    // Check for existing user with same email
    const existingUser = await this.usersService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new UnauthorizedException('Email already exists');
    }

    // Create new user (password hashing handled in UsersService)
    const user = await this.usersService.create(registerDto);

    // Create JWT payload for new user
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    // Generate initial tokens for immediate login
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    // Store refresh token for future validation
    await this.usersService.updateRefreshToken(user.id, refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * Generates a JWT access token with short expiration time.
   * Used for API authentication and authorization.
   *
   * @private
   * @param payload - JWT payload containing user information
   * @returns Signed JWT access token
   * @remarks
   * TODO: Add token fingerprinting for additional security
   * TODO: Implement token versioning for backward compatibility
   * TODO: Add custom claims support
   */
  private generateAccessToken(payload: any) {
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get('jwt.accessTokenExpiresIn'),
    });
  }

  /**
   * Generates a JWT refresh token with longer expiration time.
   * Used to obtain new access tokens without re-authentication.
   *
   * @private
   * @param payload - JWT payload containing user information
   * @returns Signed JWT refresh token
   * @remarks
   * TODO: Implement refresh token rotation on each use
   * TODO: Add refresh token blacklisting capability
   * TODO: Implement maximum refresh token lifetime
   * TODO: Add refresh token usage tracking
   */
  private generateRefreshToken(payload: any) {
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get('jwt.refreshTokenExpiresIn'),
    });
  }

  /**
   * Validates user existence by ID for JWT strategy.
   * Used by Passport JWT strategy to verify token authenticity.
   *
   * @param userId - User ID extracted from JWT token
   * @returns User object if found, null otherwise
   * @remarks
   * TODO: Add user status validation (active/inactive/suspended)
   * TODO: Implement user session validation
   * TODO: Add user permission caching for performance
   * TODO: Implement user data sanitization for security
   */
  async validateUser(userId: string): Promise<any> {
    const user = await this.usersService.findOne(userId);

    if (!user) {
      return null;
    }

    return user;
  }

  /**
   * Refreshes JWT access token using a valid refresh token.
   * Implements token rotation for enhanced security by issuing new tokens.
   *
   * @param refreshToken - Valid refresh token from previous authentication
   * @returns Object containing new access and refresh tokens
   * @throws UnauthorizedException for invalid, expired, or tampered tokens
   * @remarks
   * TODO: Implement refresh token blacklisting for compromised tokens
   * TODO: Add refresh token usage tracking and analytics
   * TODO: Implement maximum refresh token lifetime limits
   * TODO: Add concurrent session management
   * TODO: Implement refresh token fingerprinting
   */
  async refresh(refreshToken: string) {
    try {
      // Verify refresh token signature and expiration
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('jwt.secret'),
      });

      // Validate user still exists
      const user = await this.usersService.findOne(payload.sub);

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Create new token payload
      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
      };

      // Generate new token pair (rotation)
      const newAccessToken = this.generateAccessToken(newPayload);
      const newRefreshToken = this.generateRefreshToken(newPayload);

      // Update stored refresh token (invalidates old one)
      await this.usersService.updateRefreshToken(user.id, newRefreshToken);

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Validates if a user has one of the required roles.
   * Used by role-based guards for authorization checks.
   *
   * @param userId - User ID to check roles for
   * @param requiredRoles - Array of role names that are acceptable
   * @returns True if user exists and has one of the required roles, false otherwise
   * @remarks
   * TODO: Implement role hierarchy and inheritance
   * TODO: Add role caching for performance
   * TODO: Implement dynamic role assignment
   * TODO: Add role validation audit logging
   * TODO: Consider implementing permission-based authorization
   */
  async validateUserRoles(userId: string, requiredRoles: string[]): Promise<boolean> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      return false;
    }
    return requiredRoles.includes(user.role);
  }
}

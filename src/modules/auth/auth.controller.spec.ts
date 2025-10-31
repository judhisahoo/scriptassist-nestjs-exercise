import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TestUtils } from '../../../test/jest-setup';

/**
 * Test suite for AuthController
 * Tests authentication endpoints including login, registration, and token refresh
 *
 * @description
 * This test suite covers:
 * - User registration with various scenarios
 * - User login with valid and invalid credentials
 * - JWT token refresh functionality
 * - Error handling and edge cases
 * - Controller instantiation and dependency injection
 */
describe('AuthController', () => {
  /** Controller instance under test */
  let controller: AuthController;

  /** Mocked AuthService for testing */
  let authService: jest.Mocked<AuthService>;

  /** Mock implementation of AuthService methods */
  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
  };

  /**
   * Setup test module and dependencies before each test
   */
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  /**
   * Cleanup after each test to prevent test interference
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'john.doe@example.com',
        name: 'John Doe',
        password: 'Password123!',
      };

      const expectedResult = {
        access_token: 'jwt.access.token',
        refresh_token: 'jwt.refresh.token',
        user: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'john.doe@example.com',
          name: 'John Doe',
        },
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.register(registerDto);

      // Assert
      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(mockAuthService.register).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResult);
    });

    it('should handle registration with minimum required fields', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'Pass123!',
      };

      const expectedResult = {
        access_token: 'jwt.token',
        refresh_token: 'refresh.token',
        user: {
          id: '123e4567-e89b-12d3-a456-426614174001',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      mockAuthService.register.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.register(registerDto);

      // Assert
      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(expectedResult);
    });

    it('should handle registration service errors', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'existing@example.com',
        name: 'Existing User',
        password: 'Password123!',
      };

      const error = new Error('User already exists');
      mockAuthService.register.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.register(registerDto)).rejects.toThrow('User already exists');
      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should validate email format in registration', async () => {
      // Arrange
      const invalidRegisterDto = {
        email: 'invalid-email',
        name: 'Test User',
        password: 'Password123!',
      } as RegisterDto;

      // Act & Assert
      // Note: Validation would be handled by pipes, but we test the service call
      mockAuthService.register.mockRejectedValue(new Error('Invalid email format'));

      await expect(controller.register(invalidRegisterDto)).rejects.toThrow('Invalid email format');
    });
  });

  describe('POST /auth/login', () => {
    it('should login user successfully with valid credentials', async () => {
      // Arrange
      const loginDto: LoginDto = {
        email: 'john.doe@example.com',
        password: 'Password123!',
      };

      const expectedResult = {
        access_token: 'jwt.access.token',
        refresh_token: 'jwt.refresh.token',
        user: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'john.doe@example.com',
          name: 'John Doe',
        },
      };

      mockAuthService.login.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.login(loginDto);

      // Assert
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
      expect(mockAuthService.login).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResult);
    });

    it('should handle login with correct email but wrong password', async () => {
      // Arrange
      const loginDto: LoginDto = {
        email: 'john.doe@example.com',
        password: 'WrongPassword123!',
      };

      const error = new Error('Invalid credentials');
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow('Invalid credentials');
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should handle login for non-existent user', async () => {
      // Arrange
      const loginDto: LoginDto = {
        email: 'nonexistent@example.com',
        password: 'Password123!',
      };

      const error = new Error('User not found');
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow('User not found');
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should handle empty email field', async () => {
      // Arrange
      const loginDto = {
        email: '',
        password: 'Password123!',
      } as LoginDto;

      const error = new Error('Email is required');
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow('Email is required');
    });

    it('should handle empty password field', async () => {
      // Arrange
      const loginDto = {
        email: 'john.doe@example.com',
        password: '',
      } as LoginDto;

      const error = new Error('Password is required');
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow('Password is required');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens successfully with valid refresh token', async () => {
      // Arrange
      const refreshDto: RefreshDto = {
        refreshToken: 'valid.refresh.token',
      };

      const expectedResult = {
        access_token: 'new.jwt.access.token',
        refresh_token: 'new.jwt.refresh.token',
      };

      mockAuthService.refresh.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.refresh(refreshDto);

      // Assert
      expect(mockAuthService.refresh).toHaveBeenCalledWith('valid.refresh.token');
      expect(mockAuthService.refresh).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResult);
    });

    it('should handle refresh with expired token', async () => {
      // Arrange
      const refreshDto: RefreshDto = {
        refreshToken: 'expired.refresh.token',
      };

      const error = new Error('Token expired');
      mockAuthService.refresh.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.refresh(refreshDto)).rejects.toThrow('Token expired');
      expect(mockAuthService.refresh).toHaveBeenCalledWith('expired.refresh.token');
    });

    it('should handle refresh with invalid token format', async () => {
      // Arrange
      const refreshDto: RefreshDto = {
        refreshToken: 'invalid-token-format',
      };

      const error = new Error('Invalid token format');
      mockAuthService.refresh.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.refresh(refreshDto)).rejects.toThrow('Invalid token format');
      expect(mockAuthService.refresh).toHaveBeenCalledWith('invalid-token-format');
    });

    it('should handle refresh with empty token', async () => {
      // Arrange
      const refreshDto = {
        refreshToken: '',
      } as RefreshDto;

      const error = new Error('Refresh token is required');
      mockAuthService.refresh.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.refresh(refreshDto)).rejects.toThrow('Refresh token is required');
    });

    it('should handle refresh with tampered token', async () => {
      // Arrange
      const refreshDto: RefreshDto = {
        refreshToken: 'tampered.refresh.token',
      };

      const error = new Error('Token verification failed');
      mockAuthService.refresh.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.refresh(refreshDto)).rejects.toThrow('Token verification failed');
    });
  });

  describe('Controller instantiation', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have auth service injected', () => {
      expect(controller).toHaveProperty('authService');
    });
  });

  describe('Error handling', () => {
    it('should propagate service errors to caller', async () => {
      // Arrange
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };

      const serviceError = new Error('Database connection failed');
      mockAuthService.login.mockRejectedValue(serviceError);

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow('Database connection failed');
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'Password123!',
      };

      mockAuthService.register.mockRejectedValue(new Error('Unexpected error'));

      // Act & Assert
      await expect(controller.register(registerDto)).rejects.toThrow('Unexpected error');
    });
  });
});
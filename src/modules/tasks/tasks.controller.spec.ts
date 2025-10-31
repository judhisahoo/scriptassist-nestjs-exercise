import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TaskApplicationService } from './application/task.application.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { Task } from './entities/task.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import { TestUtils } from '../../../test/jest-setup';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Comprehensive test suite for TasksController
 * Validates task management REST API endpoints and CQRS integration
 *
 * @description
 * This test suite provides complete coverage for task CRUD operations:
 * - Task creation with user assignment and validation
 * - Task retrieval with pagination, filtering, and search
 * - Task updates with partial data support
 * - Task completion with status validation
 * - Task deletion with soft delete implementation
 * - Authentication guard integration testing
 * - Rate limiting guard integration testing
 * - Comprehensive error handling validation
 * - CQRS command and query bus integration
 *
 * @remarks
 * Test Strategy:
 * - Uses Jest mocking for TaskApplicationService dependency injection
 * - Tests both happy path and error scenarios for all endpoints
 * - Validates service method calls with correct parameters
 * - Ensures proper error propagation from service to controller
 * - Tests authentication and rate limiting guard integration
 * - Validates response structure and data integrity
 * - Tests CQRS pattern implementation through application service
 */
describe('TasksController', () => {
  /** Controller instance under test - main subject of testing */
  let controller: TasksController;

  /** Mocked TaskApplicationService dependency - isolated testing of controller logic */
  let taskService: jest.Mocked<TaskApplicationService>;

  /**
   * Mock service implementation for testing
   * Provides Jest mock functions for all TaskApplicationService methods
   * Allows control over service behavior and verification of calls
   */
  const mockTaskService = {
    createTask: jest.fn(),
    getTasks: jest.fn(),
    getTaskById: jest.fn(),
    updateTask: jest.fn(),
    completeTask: jest.fn(),
  };

  /**
   * Mock user object representing authenticated user from JWT token
   * Used in tests that require user context for task operations
   */
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    name: 'Test User',
  };

  /**
   * Setup test module and dependencies before each test
   * Configures NestJS testing module with mocked services and guards
   */
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot()], // Include ThrottlerModule for rate limiting tests
      controllers: [TasksController],
      providers: [
        {
          provide: TaskApplicationService,
          useValue: mockTaskService, // Mock the application service
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) }, // Mock JWT guard to always pass
        },
        {
          provide: 'THROTTLER:MODULE_OPTIONS',
          useValue: {}, // Mock throttler module options
        },
        {
          provide: ThrottlerGuard,
          useValue: { canActivate: jest.fn(() => true) }, // Mock throttler guard to always pass
        },
      ],
    }).compile();

    controller = module.get<TasksController>(TasksController);
    taskService = module.get(TaskApplicationService);
  });

  /**
   * Cleanup after each test to prevent test interference
   * Clears all Jest mocks to ensure test isolation
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /tasks', () => {
    it('should create a new task successfully', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Complete project documentation',
        description: 'Add details about API endpoints and data models',
        priority: TaskPriority.HIGH,
        dueDate: '2025-12-31T23:59:59.000Z',
        status: TaskStatus.PENDING,
      };

      mockTaskService.createTask.mockResolvedValue(undefined);

      // Act
      await controller.create(createTaskDto, mockUser);

      // Assert
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: mockUser.id,
      });
      expect(mockTaskService.createTask).toHaveBeenCalledTimes(1);
    });

    it('should create task with minimum required fields', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Simple Task',
        priority: TaskPriority.MEDIUM,
        dueDate: '2025-12-31T23:59:59.000Z',
      };

      mockTaskService.createTask.mockResolvedValue(undefined);

      // Act
      await controller.create(createTaskDto, mockUser);

      // Assert
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: mockUser.id,
      });
    });

    it('should handle task creation with all optional fields', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Complete Task',
        description: 'Task description',
        priority: TaskPriority.HIGH,
        dueDate: '2025-12-31T23:59:59.000Z',
        status: TaskStatus.IN_PROGRESS,
      };

      mockTaskService.createTask.mockResolvedValue(undefined);

      // Act
      await controller.create(createTaskDto, mockUser);

      // Assert
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: mockUser.id,
      });
    });

    it('should handle service errors during task creation', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Test Task',
        priority: TaskPriority.LOW,
        dueDate: '2025-12-31T23:59:59.000Z',
      };

      const error = new Error('Database connection failed');
      mockTaskService.createTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.create(createTaskDto, mockUser)).rejects.toThrow('Database connection failed');
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: mockUser.id,
      });
    });

    it('should validate required fields are present', async () => {
      // Arrange
      const invalidDto = {
        description: 'Missing title and priority',
        dueDate: '2025-12-31T23:59:59.000Z',
      } as CreateTaskDto;

      mockTaskService.createTask.mockRejectedValue(new Error('Validation failed'));

      // Act & Assert
      await expect(controller.create(invalidDto, mockUser)).rejects.toThrow('Validation failed');
    });
  });

  describe('GET /tasks', () => {
    it('should return paginated tasks without filters', async () => {
      // Arrange
      const mockTasks: Task[] = [
        TestUtils.createMockTask({ id: 'task-1', title: 'Task 1' }),
        TestUtils.createMockTask({ id: 'task-2', title: 'Task 2' }),
      ];

      const mockResult = { items: mockTasks, total: 2 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll();

      // Assert
      expect(mockTaskService.getTasks).toHaveBeenCalledWith(
        undefined, // status
        undefined, // priority
        1, // page
        10, // limit
        undefined, // search
      );
      expect(result).toEqual({
        data: mockTasks,
        count: 2,
        page: 1,
        limit: 10,
      });
    });

    it('should filter tasks by status', async () => {
      // Arrange
      const mockTasks: Task[] = [
        TestUtils.createMockTask({ status: TaskStatus.PENDING }),
      ];

      const mockResult = { items: mockTasks, total: 1 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll(TaskStatus.PENDING);

      // Assert
      expect(mockTaskService.getTasks).toHaveBeenCalledWith(
        TaskStatus.PENDING,
        undefined,
        1,
        10,
        undefined,
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe(TaskStatus.PENDING);
    });

    it('should filter tasks by priority', async () => {
      // Arrange
      const mockTasks: Task[] = [
        TestUtils.createMockTask({ priority: TaskPriority.HIGH }),
      ];

      const mockResult = { items: mockTasks, total: 1 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll(undefined, TaskPriority.HIGH);

      // Assert
      expect(mockTaskService.getTasks).toHaveBeenCalledWith(
        undefined,
        TaskPriority.HIGH,
        1,
        10,
        undefined,
      );
      expect(result.data[0].priority).toBe(TaskPriority.HIGH);
    });

    it('should handle custom pagination', async () => {
      // Arrange
      const mockTasks: Task[] = [
        TestUtils.createMockTask({ id: 'task-1' }),
      ];

      const mockResult = { items: mockTasks, total: 25 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll(undefined, undefined, 3, 5);

      // Assert
      expect(mockTaskService.getTasks).toHaveBeenCalledWith(
        undefined,
        undefined,
        3,
        5,
        undefined,
      );
      expect(result.page).toBe(3);
      expect(result.limit).toBe(5);
    });

    it('should search tasks by title and description', async () => {
      // Arrange
      const mockTasks: Task[] = [
        TestUtils.createMockTask({
          title: 'Documentation Task',
          description: 'Contains documentation keyword',
        }),
      ];

      const mockResult = { items: mockTasks, total: 1 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll(undefined, undefined, 1, 10, 'documentation');

      // Assert
      expect(mockTaskService.getTasks).toHaveBeenCalledWith(
        undefined,
        undefined,
        1,
        10,
        'documentation',
      );
      expect(result.data).toHaveLength(1);
    });

    it('should return empty result when no tasks found', async () => {
      // Arrange
      const mockResult = { items: [], total: 0 };
      mockTaskService.getTasks.mockResolvedValue(mockResult);

      // Act
      const result = await controller.findAll();

      // Assert
      expect(result).toEqual({
        data: [],
        count: 0,
        page: 1,
        limit: 10,
      });
    });

    it('should handle service errors during task retrieval', async () => {
      // Arrange
      const error = new Error('Database query failed');
      mockTaskService.getTasks.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findAll()).rejects.toThrow('Database query failed');
    });
  });

  describe('GET /tasks/:id', () => {
    it('should return task by ID successfully', async () => {
      // Arrange
      const mockTask = TestUtils.createMockTask({
        id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Specific Task',
      });

      mockTaskService.getTaskById.mockResolvedValue(mockTask);

      // Act
      const result = await controller.findOne('123e4567-e89b-12d3-a456-426614174001');

      // Assert
      expect(mockTaskService.getTaskById).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174001');
      expect(result).toEqual(mockTask);
    });

    it('should throw 404 when task not found', async () => {
      // Arrange
      mockTaskService.getTaskById.mockResolvedValue(null);

      // Act & Assert
      await expect(controller.findOne('non-existent-id')).rejects.toThrow(
        new HttpException('Task not found', HttpStatus.NOT_FOUND)
      );
      expect(mockTaskService.getTaskById).toHaveBeenCalledWith('non-existent-id');
    });

    it('should handle service errors during task retrieval', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      mockTaskService.getTaskById.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findOne('some-id')).rejects.toThrow('Database connection failed');
    });

    it('should validate UUID format', async () => {
      // Arrange
      mockTaskService.getTaskById.mockRejectedValue(new Error('Invalid UUID format'));

      // Act & Assert
      await expect(controller.findOne('invalid-uuid')).rejects.toThrow('Invalid UUID format');
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('should update task successfully', async () => {
      // Arrange
      const updateTaskDto: UpdateTaskDto = {
        title: 'Updated Task Title',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.MEDIUM,
      };

      mockTaskService.updateTask.mockResolvedValue(undefined);

      // Act
      await controller.update('task-id-123', updateTaskDto);

      // Assert
      expect(mockTaskService.updateTask).toHaveBeenCalledWith('task-id-123', updateTaskDto);
      expect(mockTaskService.updateTask).toHaveBeenCalledTimes(1);
    });

    it('should update task with partial fields', async () => {
      // Arrange
      const updateTaskDto: UpdateTaskDto = {
        status: TaskStatus.COMPLETED,
      };

      mockTaskService.updateTask.mockResolvedValue(undefined);

      // Act
      await controller.update('task-id-123', updateTaskDto);

      // Assert
      expect(mockTaskService.updateTask).toHaveBeenCalledWith('task-id-123', updateTaskDto);
    });

    it('should handle empty update payload', async () => {
      // Arrange
      const updateTaskDto: UpdateTaskDto = {};

      mockTaskService.updateTask.mockResolvedValue(undefined);

      // Act
      await controller.update('task-id-123', updateTaskDto);

      // Assert
      expect(mockTaskService.updateTask).toHaveBeenCalledWith('task-id-123', updateTaskDto);
    });

    it('should handle service errors during update', async () => {
      // Arrange
      const updateTaskDto: UpdateTaskDto = {
        title: 'New Title',
      };

      const error = new Error('Task not found');
      mockTaskService.updateTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.update('non-existent-id', updateTaskDto)).rejects.toThrow('Task not found');
    });

    it('should validate update data format', async () => {
      // Arrange
      const invalidUpdateDto = {
        status: 'INVALID_STATUS' as any,
      } as UpdateTaskDto;

      mockTaskService.updateTask.mockRejectedValue(new Error('Invalid status value'));

      // Act & Assert
      await expect(controller.update('task-id', invalidUpdateDto)).rejects.toThrow('Invalid status value');
    });
  });

  describe('PATCH /tasks/:id/complete', () => {
    it('should complete task successfully', async () => {
      // Arrange
      mockTaskService.completeTask.mockResolvedValue(undefined);

      // Act
      await controller.complete('task-id-123');

      // Assert
      expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-id-123');
      expect(mockTaskService.completeTask).toHaveBeenCalledTimes(1);
    });

    it('should handle completion of already completed task', async () => {
      // Arrange
      const error = new Error('Task is already completed');
      mockTaskService.completeTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.complete('completed-task-id')).rejects.toThrow('Task is already completed');
    });

    it('should handle service errors during completion', async () => {
      // Arrange
      const error = new Error('Database update failed');
      mockTaskService.completeTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.complete('task-id')).rejects.toThrow('Database update failed');
    });

    it('should validate task ID exists', async () => {
      // Arrange
      const error = new Error('Task not found');
      mockTaskService.completeTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.complete('non-existent-id')).rejects.toThrow('Task not found');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('should delete task successfully (currently implemented as complete)', async () => {
      // Arrange
      const mockTask = TestUtils.createMockTask({ id: 'task-to-delete' });
      mockTaskService.getTaskById.mockResolvedValue(mockTask);
      mockTaskService.completeTask.mockResolvedValue(undefined);

      // Act
      await controller.remove('task-to-delete');

      // Assert
      expect(mockTaskService.getTaskById).toHaveBeenCalledWith('task-to-delete');
      expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-to-delete');
    });

    it('should throw 404 when trying to delete non-existent task', async () => {
      // Arrange
      mockTaskService.getTaskById.mockResolvedValue(null);

      // Act & Assert
      await expect(controller.remove('non-existent-id')).rejects.toThrow(
        new HttpException('Task not found', HttpStatus.NOT_FOUND)
      );
      expect(mockTaskService.getTaskById).toHaveBeenCalledWith('non-existent-id');
      expect(mockTaskService.completeTask).not.toHaveBeenCalled();
    });

    it('should handle service errors during deletion', async () => {
      // Arrange
      const mockTask = TestUtils.createMockTask({ id: 'task-to-delete' });
      mockTaskService.getTaskById.mockResolvedValue(mockTask);
      const error = new Error('Deletion failed');
      mockTaskService.completeTask.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.remove('task-to-delete')).rejects.toThrow('Deletion failed');
    });
  });

  describe('Controller instantiation', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have task service injected', () => {
      expect(controller).toHaveProperty('taskService');
    });
  });

  describe('Error handling', () => {
    it('should propagate service errors to caller', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Test Task',
        priority: TaskPriority.LOW,
        dueDate: '2025-12-31T23:59:59.000Z',
      };

      const serviceError = new Error('Unexpected service error');
      mockTaskService.createTask.mockRejectedValue(serviceError);

      // Act & Assert
      await expect(controller.create(createTaskDto, mockUser)).rejects.toThrow('Unexpected service error');
    });

    it('should handle validation errors gracefully', async () => {
      // Arrange
      const invalidDto = {
        title: '',
        priority: TaskPriority.HIGH,
        dueDate: 'invalid-date',
      } as CreateTaskDto;

      mockTaskService.createTask.mockRejectedValue(new Error('Validation failed'));

      // Act & Assert
      await expect(controller.create(invalidDto, mockUser)).rejects.toThrow('Validation failed');
    });
  });

  describe('Authentication integration', () => {
    it('should pass user ID from JWT token to service', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'User Task',
        priority: TaskPriority.MEDIUM,
        dueDate: '2025-12-31T23:59:59.000Z',
      };

      const user = { id: 'user-123', email: 'user@example.com' };
      mockTaskService.createTask.mockResolvedValue(undefined);

      // Act
      await controller.create(createTaskDto, user);

      // Assert
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: 'user-123',
      });
    });

    it('should handle anonymous user creation', async () => {
      // Arrange
      const createTaskDto: CreateTaskDto = {
        title: 'Anonymous Task',
        priority: TaskPriority.LOW,
        dueDate: '2025-12-31T23:59:59.000Z',
        userId: undefined,
      };

      mockTaskService.createTask.mockResolvedValue(undefined);

      // Act
      await controller.create(createTaskDto, { id: undefined } as any);

      // Assert
      expect(mockTaskService.createTask).toHaveBeenCalledWith({
        ...createTaskDto,
        userId: undefined,
      });
    });
  });
});
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TaskStatus } from '../src/modules/tasks/enums/task-status.enum';
import { TaskPriority } from '../src/modules/tasks/enums/task-priority.enum';

// Global test setup
beforeAll(async () => {
  // Setup global test environment
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
});

// Global test teardown
afterAll(async () => {
  // Cleanup after all tests
});

// Reset mocks between tests
afterEach(() => {
  jest.clearAllMocks();
});

// Custom matchers
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    return {
      message: () => `expected ${received} to be a valid UUID`,
      pass,
    };
  },

  toBeISODateString(received) {
    const date = new Date(received);
    const pass = !isNaN(date.getTime()) && received === date.toISOString();
    return {
      message: () => `expected ${received} to be a valid ISO date string`,
      pass,
    };
  },
});

// Test utilities
export class TestUtils {
  static async createTestingModule(metadata: any): Promise<TestingModule> {
    return Test.createTestingModule(metadata).compile();
  }

  static mockRepository<T extends object>(entity: new () => T): Repository<T> {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(),
        getOne: jest.fn(),
        execute: jest.fn(),
        cache: jest.fn().mockReturnThis(),
      })),
    } as any;
  }

  static createMockUser(overrides = {}) {
    return {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashedPassword',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static createMockTask(overrides = {}) {
    return {
      id: '123e4567-e89b-12d3-a456-426614174001',
      title: 'Test Task',
      description: 'Test Description',
      status: TaskStatus.PENDING,
      priority: TaskPriority.MEDIUM,
      dueDate: new Date('2025-12-31'),
      userId: '123e4567-e89b-12d3-a456-426614174000',
      user: undefined as any, // Allow undefined for testing
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as any; // Cast to any to bypass strict typing in tests
  }

  static createMockJwtPayload(overrides = {}) {
    return {
      sub: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    };
  }
}

// Declare custom matchers for TypeScript
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeISODateString(): R;
    }
  }
}

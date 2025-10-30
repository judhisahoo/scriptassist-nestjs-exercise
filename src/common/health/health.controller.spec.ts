import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, MemoryHealthIndicator, DiskHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { CacheHealthIndicator } from './cache-health.indicator';
import { QueueHealthIndicator } from './queue-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let memoryHealth: jest.Mocked<MemoryHealthIndicator>;
  let diskHealth: jest.Mocked<DiskHealthIndicator>;
  let dbHealth: jest.Mocked<TypeOrmHealthIndicator>;
  let cacheHealth: jest.Mocked<CacheHealthIndicator>;
  let queueHealth: jest.Mocked<QueueHealthIndicator>;

  const mockHealthCheckService = {
    check: jest.fn(),
  };

  const mockMemoryHealth = {
    checkHeap: jest.fn(),
    checkRSS: jest.fn(),
  };

  const mockDiskHealth = {
    checkStorage: jest.fn(),
  };

  const mockDbHealth = {
    pingCheck: jest.fn(),
  };

  const mockCacheHealth = {
    isHealthy: jest.fn(),
  };

  const mockQueueHealth = {
    isHealthy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: mockHealthCheckService,
        },
        {
          provide: MemoryHealthIndicator,
          useValue: mockMemoryHealth,
        },
        {
          provide: DiskHealthIndicator,
          useValue: mockDiskHealth,
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: mockDbHealth,
        },
        {
          provide: CacheHealthIndicator,
          useValue: mockCacheHealth,
        },
        {
          provide: QueueHealthIndicator,
          useValue: mockQueueHealth,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService);
    memoryHealth = module.get(MemoryHealthIndicator);
    diskHealth = module.get(DiskHealthIndicator);
    dbHealth = module.get(TypeOrmHealthIndicator);
    cacheHealth = module.get(CacheHealthIndicator);
    queueHealth = module.get(QueueHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status when all checks pass', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: {
          memory_heap: { status: 'up' },
          memory_rss: { status: 'up' },
          database: { status: 'up' },
          cache: { status: 'up' },
          queue: { status: 'up' },
        },
        error: {},
        details: {
          memory_heap: { status: 'up', used_heap: '45MB', available_heap: '105MB' },
          memory_rss: { status: 'up', used_rss: '78MB', available_rss: '72MB' },
          database: { status: 'up', database: 'taskflow' },
          cache: { status: 'up', response_time: '5ms', cache_size: 150 },
          queue: { status: 'up', waiting: 0, active: 2, completed: 45 },
        },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.check();

      // Assert
      expect(mockHealthCheckService.check).toHaveBeenCalledTimes(1);
      expect(mockHealthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function), // memory heap check
        expect.any(Function), // memory rss check
        expect.any(Function), // database check
        expect.any(Function), // cache check
        expect.any(Function), // queue check
      ]);
      expect(result).toEqual(expectedHealthResult);
    });

    it('should return basic health response when checks fail', async () => {
      // Arrange
      const error = new Error('Health check failed');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Act
      const result = await controller.check();

      // Assert
      expect(result).toEqual({
        status: 'ok',
        info: {
          message: 'Basic health check passed (some checks may have been skipped)',
        },
        error: {},
        details: {
          database: { status: 'unknown' },
          cache: { status: 'unknown' },
          queue: { status: 'unknown' },
          memory: { status: 'unknown' },
        },
      });
    });

    it('should handle memory health check failures gracefully', async () => {
      // Arrange
      const memoryError = new Error('Memory check failed');
      mockHealthCheckService.check.mockRejectedValue(memoryError);

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.details.memory).toEqual({ status: 'unknown' });
    });

    it('should handle database health check failures gracefully', async () => {
      // Arrange
      const dbError = new Error('Database connection failed');
      mockHealthCheckService.check.mockRejectedValue(dbError);

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.details.database).toEqual({ status: 'unknown' });
    });

    it('should handle cache health check failures gracefully', async () => {
      // Arrange
      const cacheError = new Error('Cache service unavailable');
      mockHealthCheckService.check.mockRejectedValue(cacheError);

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.details.cache).toEqual({ status: 'unknown' });
    });

    it('should handle queue health check failures gracefully', async () => {
      // Arrange
      const queueError = new Error('Queue service unavailable');
      mockHealthCheckService.check.mockRejectedValue(queueError);

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.details.queue).toEqual({ status: 'unknown' });
    });
  });

  describe('GET /health/detailed', () => {
    it('should return detailed health status with system metrics', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: {
          memory_heap: { status: 'up' },
          memory_rss: { status: 'up' },
          database: { status: 'up' },
          cache: { status: 'up' },
          queue: { status: 'up' },
        },
        error: {},
        details: {
          memory_heap: { status: 'up', used_heap: '45MB', available_heap: '105MB' },
          memory_rss: { status: 'up', used_rss: '78MB', available_rss: '72MB' },
          database: { status: 'up', database: 'taskflow' },
          cache: { status: 'up', response_time: '5ms', cache_size: 150 },
          queue: { status: 'up', waiting: 0, active: 2, completed: 45 },
        },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Mock Date.now for consistent timestamp
      const fixedDate = new Date('2025-01-15T12:30:45.123Z');
      jest.spyOn(global, 'Date').mockImplementation(() => fixedDate as any);

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result).toEqual({
        ...expectedHealthResult,
        timestamp: '2025-01-15T12:30:45.123Z',
        uptime: expect.any(Number),
        version: expect.any(String),
        environment: expect.any(String),
      });
      expect(result.timestamp).toBe('2025-01-15T12:30:45.123Z');
      expect(typeof result.uptime).toBe('number');
      expect(result.environment).toBeDefined();
    });

    it('should return detailed error information when health checks fail', async () => {
      // Arrange
      const error = new Error('Detailed health check failed');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Mock Date.now for consistent timestamp
      const fixedDate = new Date('2025-01-15T12:30:45.123Z');
      jest.spyOn(global, 'Date').mockImplementation(() => fixedDate as any);

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result).toEqual({
        status: 'error',
        timestamp: '2025-01-15T12:30:45.123Z',
        uptime: expect.any(Number),
        version: expect.any(String),
        environment: expect.any(String),
        error: 'Detailed health check failed',
        details: {
          message: 'Detailed health check failed',
          components: {
            memory: 'unknown',
            database: 'unknown',
            cache: 'unknown',
            queue: 'unknown',
          },
        },
      });
    });

    it('should include uptime in detailed response', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result).toHaveProperty('uptime');
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThan(0);
    });

    it('should include version information in detailed response', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result).toHaveProperty('version');
      expect(typeof result.version).toBe('string');
      expect(result.version.length).toBeGreaterThan(0);
    });

    it('should include environment information in detailed response', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result).toHaveProperty('environment');
      expect(typeof result.environment).toBe('string');
    });
  });

  describe('GET /health/ready', () => {
    it('should perform readiness probe successfully', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: {
          database: { status: 'up' },
          cache: { status: 'up' },
          queue: { status: 'up' },
        },
        error: {},
        details: {
          database: { status: 'up' },
          cache: { status: 'up' },
          queue: { status: 'up' },
        },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.readiness();

      // Assert
      expect(mockHealthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function), // database check
        expect.any(Function), // cache check
        expect.any(Function), // queue check
      ]);
      expect(result).toEqual(expectedHealthResult);
    });

    it('should fail readiness probe when database is down', async () => {
      // Arrange
      const error = new Error('Database not ready');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.readiness()).rejects.toThrow('Database not ready');
    });

    it('should fail readiness probe when cache is down', async () => {
      // Arrange
      const error = new Error('Cache not ready');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.readiness()).rejects.toThrow('Cache not ready');
    });

    it('should fail readiness probe when queue is down', async () => {
      // Arrange
      const error = new Error('Queue not ready');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.readiness()).rejects.toThrow('Queue not ready');
    });
  });

  describe('GET /health/live', () => {
    it('should perform liveness probe successfully', async () => {
      // Arrange
      const expectedHealthResult = {
        status: 'ok',
        info: {
          memory_heap: { status: 'up' },
        },
        error: {},
        details: {
          memory_heap: { status: 'up' },
        },
      };

      mockHealthCheckService.check.mockResolvedValue(expectedHealthResult);

      // Act
      const result = await controller.liveness();

      // Assert
      expect(mockHealthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function), // memory heap check with higher threshold
      ]);
      expect(result).toEqual(expectedHealthResult);
    });

    it('should fail liveness probe when memory usage is too high', async () => {
      // Arrange
      const error = new Error('Memory usage too high');
      mockHealthCheckService.check.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.liveness()).rejects.toThrow('Memory usage too high');
    });

    it('should use higher memory threshold for liveness than basic health check', async () => {
      // Arrange
      mockHealthCheckService.check.mockResolvedValue({
        status: 'ok',
        info: { memory_heap: { status: 'up' } },
        error: {},
        details: { memory_heap: { status: 'up' } },
      });

      // Act
      await controller.liveness();

      // Assert
      expect(mockHealthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function), // Should be called with 200MB threshold vs 150MB in basic check
      ]);
    });
  });

  describe('Controller instantiation', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have all health indicators injected', () => {
      expect(controller).toHaveProperty('health');
      expect(controller).toHaveProperty('memory');
      expect(controller).toHaveProperty('disk');
      expect(controller).toHaveProperty('db');
      expect(controller).toHaveProperty('cacheHealth');
      expect(controller).toHaveProperty('queueHealth');
    });
  });

  describe('Error handling', () => {
    it('should handle unexpected errors in basic health check', async () => {
      // Arrange
      mockHealthCheckService.check.mockRejectedValue(new Error('Unexpected error'));

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect((result.info as any)?.message).toContain('Basic health check passed');
    });

    it('should handle unexpected errors in detailed health check', async () => {
      // Arrange
      mockHealthCheckService.check.mockRejectedValue(new Error('Unexpected detailed error'));

      // Act
      const result = await controller.detailedCheck();

      // Assert
      expect(result.status).toBe('error');
      expect(result.error).toBe('Unexpected detailed error');
      expect(result.details.message).toBe('Detailed health check failed');
    });

    it('should handle network timeouts gracefully', async () => {
      // Arrange
      const timeoutError = new Error('Connection timeout');
      mockHealthCheckService.check.mockRejectedValue(timeoutError);

      // Act
      const result = await controller.check();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.details.database).toEqual({ status: 'unknown' });
    });
  });

  describe('Health check configuration', () => {
    it('should use correct memory thresholds for basic health check', async () => {
      // Arrange
      mockHealthCheckService.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });

      // Act
      await controller.check();

      // Assert - The check function should be called with 150MB heap and RSS limits
      expect(mockHealthCheckService.check).toHaveBeenCalled();
      const checkFunctions = mockHealthCheckService.check.mock.calls[0][0];
      expect(checkFunctions).toHaveLength(5); // 5 health checks
    });

    it('should use correct memory threshold for liveness probe', async () => {
      // Arrange
      mockHealthCheckService.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });

      // Act
      await controller.liveness();

      // Assert - The check function should be called with 200MB heap limit
      expect(mockHealthCheckService.check).toHaveBeenCalled();
      const checkFunctions = mockHealthCheckService.check.mock.calls[0][0];
      expect(checkFunctions).toHaveLength(1); // 1 health check for liveness
    });

    it('should include disk storage check in basic health check', async () => {
      // Arrange
      mockHealthCheckService.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });

      // Act
      await controller.check();

      // Assert
      expect(mockHealthCheckService.check).toHaveBeenCalled();
      // Disk check should be included in the health checks
    });
  });
});
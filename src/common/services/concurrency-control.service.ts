import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Configuration options for optimistic locking operations,
 * defining version field and retry behavior for conflict resolution.
 */
export interface OptimisticLockOptions {
  /** Name of the version field in the entity (defaults to 'version') */
  versionField?: string;
  /** Maximum number of retry attempts on version conflicts */
  maxRetries?: number;
  /** Delay in milliseconds between retry attempts */
  retryDelay?: number;
}

/**
 * Configuration options for pessimistic locking operations,
 * defining lock timeout and lock mode for exclusive access.
 */
export interface PessimisticLockOptions {
  /** Timeout in milliseconds for acquiring the lock */
  lockTimeout?: number;
  /** SQL lock mode: 'FOR UPDATE' (exclusive) or 'FOR SHARE' (shared) */
  lockMode?: 'FOR UPDATE' | 'FOR SHARE';
}

/**
 * Concurrency control service that provides multiple locking strategies
 * for managing concurrent access to shared resources and preventing race conditions.
 *
 * Features:
 * - Optimistic locking with version-based conflict detection
 * - Pessimistic locking with database-level exclusive access
 * - Distributed locking for cross-service coordination
 * - Compare-and-set operations for atomic updates
 * - Batch operations with configurable isolation levels
 * - Concurrent modification detection
 */
@Injectable()
export class ConcurrencyControlService {
  private readonly logger = new Logger(ConcurrencyControlService.name);

  constructor(
    private dataSource: DataSource,
    private distributedLockService: DistributedLockService,
  ) {}

  /**
   * Executes an operation with optimistic locking to prevent concurrent modifications.
   * Uses version-based conflict detection and automatic retry on conflicts.
   * Suitable for scenarios with low contention where conflicts are rare.
   *
   * @param entityType - The entity class to lock
   * @param entityId - The ID of the entity to lock
   * @param operation - Function to execute with the locked entity and entity manager
   * @param options - Configuration options for optimistic locking behavior
   * @returns Result of the operation
   * @throws Error if version conflicts persist after max retries
   */
  async executeWithOptimisticLock<T>(
    entityType: any,
    entityId: string | number,
    operation: (entity: any, entityManager: EntityManager) => Promise<T>,
    options: OptimisticLockOptions = {},
  ): Promise<T> {
    const { versionField = 'version', maxRetries = 3, retryDelay = 100 } = options;

    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Load entity with current version
        const entity = await queryRunner.manager.findOne(entityType, {
          where: { id: entityId } as any,
          lock: { mode: 'optimistic' as any, version: versionField as any },
        });

        if (!entity) {
          throw new Error(`Entity ${entityType.name} with id ${entityId} not found`);
        }

        // Execute the operation
        const result = await operation(entity, queryRunner.manager);

        // Commit transaction
        await queryRunner.commitTransaction();

        this.logger.debug(
          `Optimistic lock operation succeeded for ${entityType.name}:${entityId} on attempt ${attempt}`,
        );

        return result;
      } catch (error) {
        await queryRunner.rollbackTransaction();

        if ((error as any).code === '55P03' || (error as Error).message.includes('version')) {
          // Version conflict - retry if attempts remaining
          lastError = error as Error;
          if (attempt < maxRetries) {
            this.logger.warn(
              `Optimistic lock conflict for ${entityType.name}:${entityId} on attempt ${attempt}, retrying...`,
            );
            await this.delay(retryDelay * attempt);
            continue;
          }
        }

        // Non-retryable error or max retries reached
        this.logger.error(
          `Optimistic lock operation failed for ${entityType.name}:${entityId} after ${attempt} attempts:`,
          error,
        );
        throw error;
      } finally {
        await queryRunner.release();
      }
    }

    throw lastError!;
  }

  /**
   * Executes an operation with pessimistic locking for exclusive access to entities.
   * Prevents concurrent access by acquiring database-level locks.
   * Suitable for high-contention scenarios where conflicts are expected.
   *
   * @param entityType - The entity class to lock
   * @param entityId - The ID of the entity to lock
   * @param operation - Function to execute with the locked entity and entity manager
   * @param options - Configuration options for pessimistic locking behavior
   * @returns Result of the operation
   */
  async executeWithPessimisticLock<T>(
    entityType: any,
    entityId: string | number,
    operation: (entity: any, entityManager: EntityManager) => Promise<T>,
    options: PessimisticLockOptions = {},
  ): Promise<T> {
    const { lockTimeout = 30000, lockMode = 'FOR UPDATE' } = options;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Set lock timeout
      await queryRunner.query(`SET LOCAL lock_timeout = '${lockTimeout}ms'`);

      // Load entity with pessimistic lock
      const entity = await queryRunner.manager
        .createQueryBuilder(entityType, 'entity')
        .where('entity.id = :id', { id: entityId })
        .setLock(lockMode as any)
        .getOne();

      if (!entity) {
        throw new Error(`Entity ${entityType.name} with id ${entityId} not found`);
      }

      // Execute the operation
      const result = await operation(entity, queryRunner.manager);

      // Commit transaction
      await queryRunner.commitTransaction();

      this.logger.debug(
        `Pessimistic lock operation succeeded for ${entityType.name}:${entityId}`,
      );

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();

      this.logger.error(
        `Pessimistic lock operation failed for ${entityType.name}:${entityId}:`,
        error,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Executes an operation with distributed locking for cross-service coordination.
   * Uses Redis or similar distributed store to coordinate locks across multiple service instances.
   * Essential for operations that span multiple services or require global coordination.
   *
   * @param lockResource - Unique identifier for the resource to lock
   * @param operation - Function to execute while holding the distributed lock
   * @param lockOptions - Configuration options for lock acquisition and timeout
   * @returns Result of the operation
   * @throws Error if lock cannot be acquired
   */
  async executeWithDistributedLock<T>(
    lockResource: string,
    operation: () => Promise<T>,
    lockOptions?: { ttl?: number; retryCount?: number; retryDelay?: number },
  ): Promise<T> {
    const instanceId = this.getInstanceId();
    const lockValue = await this.distributedLockService.acquireLock(
      lockResource,
      instanceId,
      lockOptions,
    );

    if (!lockValue) {
      throw new Error(`Failed to acquire distributed lock for resource: ${lockResource}`);
    }

    try {
      this.logger.debug(`Distributed lock acquired for resource: ${lockResource}`);
      const result = await operation();
      return result;
    } finally {
      await this.distributedLockService.releaseLock(lockResource, lockValue);
      this.logger.debug(`Distributed lock released for resource: ${lockResource}`);
    }
  }

  /**
   * Performs a compare-and-set operation with explicit version checking.
   * Atomically checks if the entity version matches the expected version
   * before executing the update operation. Fails immediately on version mismatch.
   *
   * @param entityType - The entity class to operate on
   * @param entityId - The ID of the entity to update
   * @param expectedVersion - The expected current version of the entity
   * @param updateOperation - Function to execute if version matches
   * @returns Result of the update operation
   * @throws Error if version doesn't match expected value
   */
  async compareAndSet<T>(
    entityType: any,
    entityId: string | number,
    expectedVersion: number,
    updateOperation: (entity: any) => Promise<T>,
  ): Promise<T> {
    return this.executeWithOptimisticLock(
      entityType,
      entityId,
      async (entity, entityManager) => {
        if (entity.version !== expectedVersion) {
          throw new Error(`Version mismatch: expected ${expectedVersion}, got ${entity.version}`);
        }

        return await updateOperation(entity);
      },
      { maxRetries: 1 }, // Single attempt for CAS
    );
  }

  /**
   * Executes multiple operations in a batch with configurable concurrency control.
   * Supports different locking strategies per operation and transaction isolation levels.
   * Useful for complex business transactions that require multiple entity updates.
   *
   * @param operations - Array of operations with their locking requirements
   * @param options - Configuration for isolation level and distributed locking
   * @returns Array of results from each operation in the same order
   */
  async executeBatchWithConcurrencyControl<T>(
    operations: Array<{
      entityType: any;
      entityId: string | number;
      operation: (entity: any, entityManager: EntityManager) => Promise<any>;
      lockType?: 'optimistic' | 'pessimistic' | 'distributed';
      lockOptions?: OptimisticLockOptions | PessimisticLockOptions;
    }>,
    options: {
      isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
      distributedLockResource?: string;
    } = {},
  ): Promise<T[]> {
    const { isolationLevel, distributedLockResource } = options;

    if (distributedLockResource) {
      // Use distributed lock for the entire batch
      return this.executeWithDistributedLock(distributedLockResource, async () =>
        this.executeBatchOperations(operations, isolationLevel),
      );
    } else {
      return this.executeBatchOperations(operations, isolationLevel);
    }
  }

  private async executeBatchOperations<T>(
    operations: Array<{
      entityType: any;
      entityId: string | number;
      operation: (entity: any, entityManager: EntityManager) => Promise<any>;
      lockType?: 'optimistic' | 'pessimistic' | 'distributed';
      lockOptions?: OptimisticLockOptions | PessimisticLockOptions;
    }>,
    isolationLevel?: string,
  ): Promise<T[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    if (isolationLevel) {
      await queryRunner.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    }

    await queryRunner.startTransaction();

    try {
      const results: T[] = [];

      for (const op of operations) {
        let result: any;

        if (op.lockType === 'pessimistic') {
          // Load entity with pessimistic lock
          const entity = await queryRunner.manager
            .createQueryBuilder(op.entityType, 'entity')
            .where('entity.id = :id', { id: op.entityId })
            .setLock('pessimistic_write' as any)
            .getOne();

          if (!entity) {
            throw new Error(`Entity ${op.entityType.name} with id ${op.entityId} not found`);
          }

          result = await op.operation(entity, queryRunner.manager);
        } else {
          // Load entity normally (optimistic locking handled in operation if needed)
          const entity = await queryRunner.manager.findOne(op.entityType, {
            where: { id: op.entityId },
          });

          if (!entity) {
            throw new Error(`Entity ${op.entityType.name} with id ${op.entityId} not found`);
          }

          result = await op.operation(entity, queryRunner.manager);
        }

        results.push(result);
      }

      await queryRunner.commitTransaction();
      this.logger.debug(`Batch operation completed successfully for ${operations.length} operations`);

      return results;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Batch operation failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Detects if an entity has been concurrently modified by comparing versions.
   * Useful for client-side optimistic locking where the client provides the last known version.
   *
   * @param entityType - The entity class to check
   * @param entityId - The ID of the entity to check
   * @param lastKnownVersion - The version the client last saw
   * @returns True if concurrent modification is detected, false otherwise
   */
  async detectConcurrentModification(
    entityType: any,
    entityId: string | number,
    lastKnownVersion: number,
  ): Promise<boolean> {
    try {
      const entity = await this.dataSource.manager.findOne(entityType as any, {
        where: { id: entityId } as any,
        select: ['version'],
      }) as { version?: number } | null;

      return !entity || entity.version !== lastKnownVersion;
    } catch (error) {
      this.logger.error('Error detecting concurrent modification:', error);
      return true; // Assume concurrent modification on error
    }
  }

  /**
   * Retrieves the current version of an entity for optimistic locking purposes.
   * Returns null if the entity doesn't exist or an error occurs.
   *
   * @param entityType - The entity class to query
   * @param entityId - The ID of the entity to get version for
   * @returns Current version number or null if not found
   */
  async getEntityVersion(entityType: any, entityId: string | number): Promise<number | null> {
    try {
      const entity = await this.dataSource.manager.findOne(entityType as any, {
        where: { id: entityId } as any,
        select: ['version'],
      }) as { version?: number } | null;

      return entity?.version || null;
    } catch (error) {
      this.logger.error('Error getting entity version:', error);
      return null;
    }
  }

  /**
   * Generates a unique instance identifier for distributed locking.
   * Combines process ID and timestamp to ensure uniqueness across instances.
   *
   * @returns Unique instance identifier string
   */
  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  /**
   * Utility method to create delays for retry mechanisms.
   * Uses Promise-based timeout for non-blocking delays.
   *
   * @param ms - Delay duration in milliseconds
   * @returns Promise that resolves after the specified delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
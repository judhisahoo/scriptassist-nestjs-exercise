import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { DistributedLockService } from './distributed-lock.service';

export interface OptimisticLockOptions {
  versionField?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface PessimisticLockOptions {
  lockTimeout?: number;
  lockMode?: 'FOR UPDATE' | 'FOR SHARE';
}

@Injectable()
export class ConcurrencyControlService {
  private readonly logger = new Logger(ConcurrencyControlService.name);

  constructor(
    private dataSource: DataSource,
    private distributedLockService: DistributedLockService,
  ) {}

  /**
   * Execute operation with optimistic locking
   * Throws ConflictException if version mismatch occurs
   */
  async executeWithOptimisticLock<T>(
    entityType: any,
    entityId: string | number,
    operation: (entity: any, entityManager: EntityManager) => Promise<T>,
    options: OptimisticLockOptions = {},
  ): Promise<T> {
    const {
      versionField = 'version',
      maxRetries = 3,
      retryDelay = 100,
    } = options;

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
   * Execute operation with pessimistic locking
   */
  async executeWithPessimisticLock<T>(
    entityType: any,
    entityId: string | number,
    operation: (entity: any, entityManager: EntityManager) => Promise<T>,
    options: PessimisticLockOptions = {},
  ): Promise<T> {
    const {
      lockTimeout = 30000, // 30 seconds
      lockMode = 'FOR UPDATE',
    } = options;

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
   * Execute operation with distributed lock (for cross-service operations)
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
   * Compare and set operation with version check
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
          throw new Error(
            `Version mismatch: expected ${expectedVersion}, got ${entity.version}`,
          );
        }

        return await updateOperation(entity);
      },
      { maxRetries: 1 }, // Single attempt for CAS
    );
  }

  /**
   * Batch operation with concurrency control
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
      return this.executeWithDistributedLock(
        distributedLockResource,
        async () => this.executeBatchOperations(operations, isolationLevel),
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
   * Check for concurrent modifications
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
   * Get entity version for optimistic locking
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

  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { DistributedLockService } from './distributed-lock.service';

export interface TransactionParticipant {
  name: string;
  prepare: (context: any) => Promise<void>;
  commit: (context: any) => Promise<void>;
  rollback: (context: any) => Promise<void>;
}

export interface SagaStep {
  name: string;
  execute: (context: any) => Promise<any>;
  compensate: (context: any) => Promise<void>;
}

export interface DistributedTransactionOptions {
  timeout?: number;
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  participants?: TransactionParticipant[];
  sagaSteps?: SagaStep[];
}

interface TransactionContext {
  transactionId: string;
  startTime: number;
  [key: string]: any;
}

@Injectable()
export class DistributedTransactionService {
  private readonly logger = new Logger(DistributedTransactionService.name);

  constructor(
    private dataSource: DataSource,
    private distributedLockService: DistributedLockService,
  ) {}

  /**
   * Execute distributed transaction using Two-Phase Commit (2PC)
   */
  async executeTwoPhaseCommit<T>(
    operation: (context: any) => Promise<T>,
    options: DistributedTransactionOptions = {},
  ): Promise<T> {
    const {
      timeout = 30000,
      isolationLevel = 'READ COMMITTED',
      participants = [],
    } = options;

    const transactionId = this.generateTransactionId();
    const context = { transactionId, startTime: Date.now() };

    this.logger.log(`Starting 2PC transaction: ${transactionId}`);

    try {
      // Phase 1: Prepare
      await this.preparePhase(participants, context, timeout);

      // Phase 2: Commit
      await this.commitPhase(participants, context);

      // Execute main operation
      const result = await operation(context);

      this.logger.log(`2PC transaction completed successfully: ${transactionId}`);
      return result;
    } catch (error) {
      this.logger.error(`2PC transaction failed: ${transactionId}`, error);

      // Rollback all participants
      await this.rollbackPhase(participants, context);

      throw error;
    }
  }

  /**
   * Execute distributed transaction using Saga pattern
   */
  async executeSaga<T>(
    sagaSteps: SagaStep[],
    options: { timeout?: number } = {},
  ): Promise<T> {
    const { timeout = 30000 } = options;
    const transactionId = this.generateTransactionId();
    const context: TransactionContext = { transactionId, startTime: Date.now() };
    const executedSteps: SagaStep[] = [];

    this.logger.log(`Starting saga transaction: ${transactionId}`);

    try {
      for (const step of sagaSteps) {
        this.logger.debug(`Executing saga step: ${step.name}`);

        const result = await step.execute(context);
        executedSteps.push(step);

        // Store result in context for next steps
        context[step.name] = result;

        // Check timeout
        if (Date.now() - context.startTime > timeout) {
          throw new Error(`Saga transaction timeout: ${transactionId}`);
        }
      }

      this.logger.log(`Saga transaction completed successfully: ${transactionId}`);
      return context as T;
    } catch (error) {
      this.logger.error(`Saga transaction failed at step ${executedSteps.length}: ${transactionId}`, error);

      // Compensate in reverse order
      for (let i = executedSteps.length - 1; i >= 0; i--) {
        const step = executedSteps[i];
        try {
          this.logger.debug(`Compensating saga step: ${step.name}`);
          await step.compensate(context);
        } catch (compensationError) {
          this.logger.error(`Compensation failed for step ${step.name}:`, compensationError);
          // Continue with other compensations even if one fails
        }
      }

      throw error;
    }
  }

  /**
   * Execute operation with database transaction and distributed coordination
   */
  async executeWithDatabaseTransaction<T>(
    operation: (entityManager: EntityManager, context: any) => Promise<T>,
    options: {
      isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
      distributedLock?: string;
      timeout?: number;
    } = {},
  ): Promise<T> {
    const {
      isolationLevel = 'READ COMMITTED',
      distributedLock,
      timeout = 30000,
    } = options;

    const transactionId = this.generateTransactionId();
    const context = { transactionId, startTime: Date.now() };

    let lockValue: string | null = null;

    try {
      // Acquire distributed lock if specified
      if (distributedLock) {
        lockValue = await this.distributedLockService.acquireLock(
          distributedLock,
          this.getInstanceId(),
          { ttl: timeout },
        );

        if (!lockValue) {
          throw new Error(`Failed to acquire distributed lock: ${distributedLock}`);
        }
      }

      // Execute database transaction
      const result = await this.dataSource.transaction(
        async (entityManager: any) => {
          // Set isolation level
          await entityManager.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);

          // Set timeout
          await entityManager.query(`SET LOCAL statement_timeout = '${timeout}ms'`);

          return await operation(entityManager, context);
        },
      );

      this.logger.debug(`Database transaction completed: ${transactionId}`);
      return result;
    } catch (error) {
      this.logger.error(`Database transaction failed: ${transactionId}`, error);
      throw error;
    } finally {
      // Release distributed lock
      if (lockValue && distributedLock) {
        await this.distributedLockService.releaseLock(distributedLock, lockValue);
      }
    }
  }

  /**
   * Execute cross-service transaction with eventual consistency
   */
  async executeEventualConsistentTransaction<T>(
    operations: Array<{
      service: string;
      operation: () => Promise<any>;
      compensate?: () => Promise<void>;
    }>,
    options: {
      timeout?: number;
      retryAttempts?: number;
    } = {},
  ): Promise<T> {
    const { timeout = 60000, retryAttempts = 3 } = options;
    const transactionId = this.generateTransactionId();
    const context: TransactionContext = { transactionId, startTime: Date.now() };
    const completedOperations: Array<{ service: string; compensate?: () => Promise<void> }> = [];

    this.logger.log(`Starting eventual consistent transaction: ${transactionId}`);

    try {
      for (const op of operations) {
        let attempt = 0;
        let success = false;

        while (attempt < retryAttempts && !success) {
          try {
            this.logger.debug(`Executing operation for service ${op.service} (attempt ${attempt + 1})`);

            const result = await op.operation();
            context[op.service] = result;

            completedOperations.push({
              service: op.service,
              compensate: op.compensate,
            });

            success = true;
          } catch (error) {
            attempt++;
            this.logger.warn(`Operation failed for service ${op.service} (attempt ${attempt}):`, error);

            if (attempt >= retryAttempts) {
              throw new Error(`Operation failed for service ${op.service} after ${retryAttempts} attempts`);
            }

            // Wait before retry
            await this.delay(Math.pow(2, attempt) * 1000);
          }
        }

        // Check timeout
        if (Date.now() - context.startTime > timeout) {
          throw new Error(`Transaction timeout: ${transactionId}`);
        }
      }

      this.logger.log(`Eventual consistent transaction completed: ${transactionId}`);
      return context as T;
    } catch (error) {
      this.logger.error(`Eventual consistent transaction failed: ${transactionId}`, error);

      // Compensate completed operations in reverse order
      for (let i = completedOperations.length - 1; i >= 0; i--) {
        const op = completedOperations[i];
        if (op.compensate) {
          try {
            this.logger.debug(`Compensating operation for service ${op.service}`);
            await op.compensate();
          } catch (compensationError) {
            this.logger.error(`Compensation failed for service ${op.service}:`, compensationError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Create transaction participant for 2PC
   */
  createParticipant(
    name: string,
    prepareFn: (context: any) => Promise<void>,
    commitFn: (context: any) => Promise<void>,
    rollbackFn: (context: any) => Promise<void>,
  ): TransactionParticipant {
    return {
      name,
      prepare: prepareFn,
      commit: commitFn,
      rollback: rollbackFn,
    };
  }

  /**
   * Create saga step
   */
  createSagaStep(
    name: string,
    executeFn: (context: any) => Promise<any>,
    compensateFn: (context: any) => Promise<void>,
  ): SagaStep {
    return {
      name,
      execute: executeFn,
      compensate: compensateFn,
    };
  }

  private async preparePhase(
    participants: TransactionParticipant[],
    context: any,
    timeout: number,
  ): Promise<void> {
    this.logger.debug(`Starting prepare phase for ${participants.length} participants`);

    for (const participant of participants) {
      try {
        this.logger.debug(`Preparing participant: ${participant.name}`);
        await participant.prepare(context);
      } catch (error) {
        this.logger.error(`Prepare failed for participant ${participant.name}:`, error);
        throw error;
      }
    }

    // Check timeout
    if (Date.now() - context.startTime > timeout) {
      throw new Error('Prepare phase timeout');
    }
  }

  private async commitPhase(
    participants: TransactionParticipant[],
    context: any,
  ): Promise<void> {
    this.logger.debug(`Starting commit phase for ${participants.length} participants`);

    for (const participant of participants) {
      try {
        this.logger.debug(`Committing participant: ${participant.name}`);
        await participant.commit(context);
      } catch (error) {
        this.logger.error(`Commit failed for participant ${participant.name}:`, error);
        // In a real 2PC implementation, you might need additional recovery logic here
        throw error;
      }
    }
  }

  private async rollbackPhase(
    participants: TransactionParticipant[],
    context: any,
  ): Promise<void> {
    this.logger.debug(`Starting rollback phase for ${participants.length} participants`);

    for (const participant of participants) {
      try {
        this.logger.debug(`Rolling back participant: ${participant.name}`);
        await participant.rollback(context);
      } catch (error) {
        this.logger.error(`Rollback failed for participant ${participant.name}:`, error);
        // Log but don't throw - rollback failures are serious but shouldn't prevent other rollbacks
      }
    }
  }

  private generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  private mapIsolationLevel(level: string): any {
    const mapping: Record<string, string> = {
      'READ UNCOMMITTED': 'READ UNCOMMITTED',
      'READ COMMITTED': 'READ COMMITTED',
      'REPEATABLE READ': 'REPEATABLE READ',
      'SERIALIZABLE': 'SERIALIZABLE',
    };
    return mapping[level] || 'READ COMMITTED';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
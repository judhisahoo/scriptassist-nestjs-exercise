import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Represents a participant in a two-phase commit (2PC) distributed transaction.
 * Each participant must implement prepare, commit, and rollback operations.
 */
export interface TransactionParticipant {
  /** Unique name identifier for the participant */
  name: string;
  /** Prepares the participant for the transaction (Phase 1 of 2PC) */
  prepare: (context: any) => Promise<void>;
  /** Commits the participant's changes (Phase 2 of 2PC) */
  commit: (context: any) => Promise<void>;
  /** Rolls back the participant's changes on transaction failure */
  rollback: (context: any) => Promise<void>;
}

/**
 * Represents a step in a Saga distributed transaction pattern.
 * Each step has an execute operation and a compensating action for rollback.
 */
export interface SagaStep {
  /** Unique name identifier for the saga step */
  name: string;
  /** Executes the forward operation of this step */
  execute: (context: any) => Promise<any>;
  /** Compensates (undoes) the effects of this step on failure */
  compensate: (context: any) => Promise<void>;
}

/**
 * Configuration options for distributed transaction execution.
 * Supports different transaction patterns and isolation levels.
 */
export interface DistributedTransactionOptions {
  /** Maximum time in milliseconds for the transaction to complete */
  timeout?: number;
  /** Database isolation level for the transaction */
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  /** List of participants for two-phase commit transactions */
  participants?: TransactionParticipant[];
  /** List of steps for saga pattern transactions */
  sagaSteps?: SagaStep[];
}

/**
 * Internal context object passed through transaction operations.
 * Contains transaction metadata and shared state between participants/steps.
 */
interface TransactionContext {
  /** Unique identifier for the transaction */
  transactionId: string;
  /** Timestamp when the transaction started */
  startTime: number;
  /** Additional context data shared between transaction participants */
  [key: string]: any;
}

/**
 * Service for managing distributed transactions across multiple services and databases.
 * Supports Two-Phase Commit (2PC), Saga pattern, and eventual consistency patterns.
 *
 * @remarks
 * This service provides:
 * - Two-Phase Commit (2PC) for strong consistency across participants
 * - Saga pattern for long-running transactions with compensation
 * - Database transactions with distributed locking
 * - Eventual consistency for cross-service operations with retry logic
 */
@Injectable()
export class DistributedTransactionService {
  /** Logger instance for transaction operations */
  private readonly logger = new Logger(DistributedTransactionService.name);

  /**
   * Creates an instance of DistributedTransactionService.
   *
   * @param dataSource - TypeORM data source for database operations
   * @param distributedLockService - Service for distributed locking coordination
   */
  constructor(
    private dataSource: DataSource,
    private distributedLockService: DistributedLockService,
  ) {}

  /**
   * Executes a distributed transaction using the Two-Phase Commit (2PC) protocol.
   * Ensures atomicity across multiple participants with prepare and commit phases.
   *
   * @param operation - The main operation to execute after successful 2PC
   * @param options - Configuration options for the transaction
   * @returns The result of the main operation
   * @throws Error if any participant fails during prepare or commit phases
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
   * Executes a distributed transaction using the Saga pattern.
   * Each step is executed sequentially, with compensation actions for rollback on failure.
   *
   * @param sagaSteps - Array of saga steps to execute in order
   * @param options - Configuration options for the saga execution
   * @returns Context object containing results from all executed steps
   * @throws Error if any step fails (compensations are executed automatically)
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
   * Executes an operation within a database transaction with optional distributed locking.
   * Combines TypeORM transaction management with distributed coordination primitives.
   *
   * @param operation - Function to execute within the transaction context
   * @param options - Transaction configuration including isolation level and locking
   * @returns The result of the operation function
   * @throws Error if the operation fails or lock acquisition fails
   */
  async executeWithDatabaseTransaction<T>(
    operation: (entityManager: EntityManager, context: any) => Promise<T>,
    options: {
      /** Database isolation level for the transaction */
      isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
      /** Optional distributed lock key to acquire before transaction */
      distributedLock?: string;
      /** Maximum time in milliseconds for the operation */
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
   * Executes cross-service operations with eventual consistency and retry logic.
   * Operations are attempted with retries, and compensations are executed on failures.
   *
   * @param operations - Array of service operations with optional compensation functions
   * @param options - Configuration for timeout and retry behavior
   * @returns Context object containing results from successful operations
   * @throws Error if any operation fails after all retry attempts
   */
  async executeEventualConsistentTransaction<T>(
    operations: Array<{
      /** Name identifier for the service */
      service: string;
      /** The operation to execute on the service */
      operation: () => Promise<any>;
      /** Optional compensation function to undo the operation on failure */
      compensate?: () => Promise<void>;
    }>,
    options: {
      /** Maximum time in milliseconds for all operations */
      timeout?: number;
      /** Number of retry attempts per operation */
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
   * Factory method to create a transaction participant for 2PC transactions.
   * Simplifies the creation of participants with proper function signatures.
   *
   * @param name - Unique name for the participant
   * @param prepareFn - Function called during the prepare phase
   * @param commitFn - Function called during the commit phase
   * @param rollbackFn - Function called during rollback
   * @returns A properly configured TransactionParticipant object
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
   * Factory method to create a saga step with execute and compensate functions.
   * Simplifies the creation of saga steps with proper function signatures.
   *
   * @param name - Unique name for the saga step
   * @param executeFn - Function to execute the forward operation
   * @param compensateFn - Function to compensate (undo) the operation on failure
   * @returns A properly configured SagaStep object
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

  /**
   * Executes the prepare phase of 2PC for all participants.
   * All participants must successfully prepare before commit phase begins.
   *
   * @private
   * @param participants - Array of transaction participants
   * @param context - Transaction context shared across participants
   * @param timeout - Maximum time allowed for prepare phase
   * @throws Error if any participant fails to prepare or timeout occurs
   */
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

  /**
   * Executes the commit phase of 2PC for all participants.
   * All participants that successfully prepared are now committed.
   *
   * @private
   * @param participants - Array of transaction participants
   * @param context - Transaction context shared across participants
   * @throws Error if any participant fails to commit
   */
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

  /**
   * Executes the rollback phase of 2PC for all participants.
   * Called when any participant fails during prepare or commit phases.
   *
   * @private
   * @param participants - Array of transaction participants
   * @param context - Transaction context shared across participants
   */
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

  /**
   * Generates a unique transaction identifier for tracking distributed transactions.
   *
   * @private
   * @returns Unique transaction ID string
   */
  private generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique instance identifier for this service instance.
   *
   * @private
   * @returns Unique instance ID string
   */
  private getInstanceId(): string {
    return `instance_${process.pid}_${Date.now()}`;
  }

  /**
   * Maps isolation level strings to database-specific values.
   * Currently supports standard SQL isolation levels.
   *
   * @private
   * @param level - Isolation level string
   * @returns Mapped isolation level value
   */
  private mapIsolationLevel(level: string): any {
    const mapping: Record<string, string> = {
      'READ UNCOMMITTED': 'READ UNCOMMITTED',
      'READ COMMITTED': 'READ COMMITTED',
      'REPEATABLE READ': 'REPEATABLE READ',
      SERIALIZABLE: 'SERIALIZABLE',
    };
    return mapping[level] || 'READ COMMITTED';
  }

  /**
   * Creates a promise-based delay for retry mechanisms and timeouts.
   *
   * @private
   * @param ms - Delay duration in milliseconds
   * @returns Promise that resolves after the specified delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
import { Injectable, Logger } from '@nestjs/common';

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
  retryableErrors?: (error: Error) => boolean;
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  private readonly defaultConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxDelay: 30000, // 30 seconds
    retryableErrors: (error: Error) => {
      // Retry on network errors, timeouts, and 5xx errors
      const retryableMessages = [
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'timeout',
        'network',
      ];
      return retryableMessages.some(msg =>
        error.message.toLowerCase().includes(msg.toLowerCase())
      );
    },
  };

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>,
    operationName = 'operation',
  ): Promise<T> {
    const retryConfig = { ...this.defaultConfig, ...config };
    let lastError: Error;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          this.logger.log(`${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        const isRetryable = retryConfig.retryableErrors
          ? retryConfig.retryableErrors(lastError)
          : true;

        if (!isRetryable || attempt === retryConfig.maxAttempts) {
          this.logger.error(
            `${operationName} failed on attempt ${attempt}/${retryConfig.maxAttempts}: ${lastError.message}`,
          );
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
          retryConfig.maxDelay,
        );

        this.logger.warn(
          `${operationName} failed on attempt ${attempt}/${retryConfig.maxAttempts}: ${lastError.message}. Retrying in ${delay}ms...`,
        );

        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  async executeWithCircuitBreaker<T>(
    circuitName: string,
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>,
    operationName = 'operation',
  ): Promise<T> {
    // Import circuit breaker dynamically to avoid circular dependency
    const { CircuitBreakerService } = await import('./circuit-breaker.service');

    // This would need to be injected in a real implementation
    // For now, we'll create a simple fallback
    return this.executeWithRetry(operation, config, operationName);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility method for common retry scenarios
  async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationName = 'database operation',
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      {
        maxAttempts: 3,
        initialDelay: 500,
        backoffMultiplier: 2,
        maxDelay: 5000,
        retryableErrors: (error: Error) => {
          const retryablePatterns = [
            'connection',
            'timeout',
            'deadlock',
            'lock wait timeout',
            'ER_LOCK_DEADLOCK',
            'ER_LOCK_WAIT_TIMEOUT',
          ];
          return retryablePatterns.some(pattern =>
            error.message.toLowerCase().includes(pattern.toLowerCase())
          );
        },
      },
      operationName,
    );
  }

  async retryExternalApiCall<T>(
    operation: () => Promise<T>,
    operationName = 'external API call',
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      {
        maxAttempts: 3,
        initialDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 10000,
        retryableErrors: (error: Error) => {
          const retryablePatterns = [
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
            'ECONNRESET',
            'timeout',
            'network',
            '502',
            '503',
            '504',
            'rate limit',
          ];
          return retryablePatterns.some(pattern =>
            error.message.toLowerCase().includes(pattern.toLowerCase())
          );
        },
      },
      operationName,
    );
  }

  async retryQueueOperation<T>(
    operation: () => Promise<T>,
    operationName = 'queue operation',
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      {
        maxAttempts: 5,
        initialDelay: 2000,
        backoffMultiplier: 1.5,
        maxDelay: 30000,
        retryableErrors: (error: Error) => {
          const retryablePatterns = [
            'connection',
            'timeout',
            'queue',
            'redis',
            'bull',
          ];
          return retryablePatterns.some(pattern =>
            error.message.toLowerCase().includes(pattern.toLowerCase())
          );
        },
      },
      operationName,
    );
  }
}
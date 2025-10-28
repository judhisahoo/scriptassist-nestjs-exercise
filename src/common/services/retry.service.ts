import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
  retryCondition?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  constructor(private configService: ConfigService) {}

  private readonly defaultConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxDelay: 30000, // 30 seconds
  };

  /**
   * Execute an operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>,
  ): Promise<RetryResult<T>> {
    const retryConfig = { ...this.defaultConfig, ...config };
    let lastError: Error;
    let totalDelay = 0;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        return {
          success: true,
          result,
          attempts: attempt,
          totalDelay,
        };
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry this error
        if (retryConfig.retryCondition && !retryConfig.retryCondition(lastError)) {
          this.logger.debug(`Not retrying error (condition not met): ${lastError.message}`);
          break;
        }

        // Don't retry on the last attempt
        if (attempt === retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay for next attempt
        const delay = Math.min(
          retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
          retryConfig.maxDelay,
        );

        totalDelay += delay;

        this.logger.warn(
          `Operation failed (attempt ${attempt}/${retryConfig.maxAttempts}): ${lastError.message}. Retrying in ${delay}ms`,
        );

        await this.delay(delay);
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts: retryConfig.maxAttempts,
      totalDelay,
    };
  }

  /**
   * Execute with circuit breaker integration
   */
  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitName: string,
    config?: Partial<RetryConfig>,
  ): Promise<RetryResult<T>> {
    // This would integrate with CircuitBreakerService
    // For now, just use basic retry
    return this.executeWithRetry(operation, config);
  }

  /**
   * Create retry configuration for common scenarios
   */
  createConfigForScenario(scenario: string): Partial<RetryConfig> {
    switch (scenario) {
      case 'database':
        return {
          maxAttempts: 3,
          initialDelay: 500,
          backoffMultiplier: 2,
          maxDelay: 5000,
          retryCondition: (error) => {
            // Retry on connection errors, not on constraint violations
            return error.message.includes('connection') ||
                   error.message.includes('timeout') ||
                   error.message.includes('ECONNREFUSED');
          },
        };

      case 'external-api':
        return {
          maxAttempts: 2,
          initialDelay: 2000,
          backoffMultiplier: 1.5,
          maxDelay: 10000,
          retryCondition: (error) => {
            // Retry on network errors and 5xx status codes
            return error.message.includes('ECONNREFUSED') ||
                   error.message.includes('timeout') ||
                   error.message.includes('500') ||
                   error.message.includes('502') ||
                   error.message.includes('503') ||
                   error.message.includes('504');
          },
        };

      case 'cache':
        return {
          maxAttempts: 2,
          initialDelay: 100,
          backoffMultiplier: 2,
          maxDelay: 1000,
          retryCondition: (error) => {
            // Retry on connection errors
            return error.message.includes('ECONNREFUSED') ||
                   error.message.includes('timeout');
          },
        };

      default:
        return {};
    }
  }

  /**
   * Execute operation with scenario-based retry
   */
  async executeForScenario<T>(
    scenario: string,
    operation: () => Promise<T>,
  ): Promise<RetryResult<T>> {
    const config = this.createConfigForScenario(scenario);
    return this.executeWithRetry(operation, config);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
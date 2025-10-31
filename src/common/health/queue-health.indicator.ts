import { Injectable, Logger, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Health indicator for BullMQ queue monitoring
 * Performs comprehensive queue health checks including connectivity, performance, and job statistics
 * Extends Terminus HealthIndicator for standardized health check responses
 */
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(QueueHealthIndicator.name);

  constructor(@InjectQueue('task-processing') private readonly taskQueue: Queue) {
    super();
  }

  /**
   * Performs comprehensive queue health check
   * Tests connectivity, measures response time, and collects job statistics
   * @param key - Health check identifier key
   * @returns Promise resolving to health check result
   * @throws HealthCheckError if queue operations fail or performance is poor
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();

      // Test basic queue connectivity and operations
      try {
        await this.taskQueue.getWaiting(0, 1); // Test basic queue operation
      } catch (error) {
        throw new HealthCheckError(
          'Queue is not ready',
          this.getStatus(key, false, {
            error: 'Queue operation failed',
          }),
        );
      }

      // Collect comprehensive queue statistics
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.taskQueue.getWaiting(), // Jobs waiting to be processed
        this.taskQueue.getActive(), // Jobs currently being processed
        this.taskQueue.getCompleted(), // Successfully completed jobs
        this.taskQueue.getFailed(), // Failed jobs
        this.taskQueue.getDelayed(), // Jobs scheduled for future execution
      ]);

      const responseTime = Date.now() - startTime;

      // Health criteria: responsive within 5 seconds
      const isHealthy = responseTime < 5000;

      if (isHealthy) {
        return this.getStatus(key, true, {
          responseTime: `${responseTime}ms`,
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          totalJobs:
            waiting.length + active.length + completed.length + failed.length + delayed.length,
        });
      } else {
        throw new HealthCheckError(
          'Queue health check failed - slow response',
          this.getStatus(key, false, {
            responseTime: `${responseTime}ms`,
            status: 'slow_response',
          }),
        );
      }
    } catch (error) {
      this.logger.error('Queue health check failed:', error);
      throw new HealthCheckError(
        'Queue health check failed',
        this.getStatus(key, false, {
          error: (error as Error).message,
          queueStatus: 'connected', // Queue is connected but operations failed
        }),
      );
    }
  }
}
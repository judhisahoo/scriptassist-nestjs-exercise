import { Injectable, Logger, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(QueueHealthIndicator.name);

  constructor(@InjectQueue('task-processing') private readonly taskQueue: Queue) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();

      // Check if queue is ready by attempting to get queue stats
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

      // Get queue statistics
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.taskQueue.getWaiting(),
        this.taskQueue.getActive(),
        this.taskQueue.getCompleted(),
        this.taskQueue.getFailed(),
        this.taskQueue.getDelayed(),
      ]);

      const responseTime = Date.now() - startTime;

      // Consider queue healthy if it's responsive and not in a critical state
      const isHealthy = responseTime < 5000; // Response within 5 seconds

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
          queueStatus: 'connected',
        }),
      );
    }
  }
}
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { CacheHealthIndicator } from './cache-health.indicator';
import { QueueHealthIndicator } from './queue-health.indicator';
import { CacheService } from '../services/cache.service';

/**
 * Health monitoring module for the application
 * Provides comprehensive health checks for all system components
 * Includes Kubernetes-style probes (readiness, liveness) and detailed diagnostics
 *
 * Features:
 * - Memory, disk, and database health checks
 * - Cache and queue service monitoring
 * - System metrics and uptime tracking
 * - Graceful degradation handling
 */
@Module({
  imports: [
    TerminusModule, // Core health check functionality
    BullModule.registerQueue({
      name: 'task-processing', // Queue for background task processing
    }),
  ],
  controllers: [HealthController], // Health check endpoints
  providers: [
    CacheHealthIndicator, // Custom cache health monitoring
    QueueHealthIndicator, // Custom queue health monitoring
    CacheService, // Required for cache health checks
  ],
  exports: [
    CacheHealthIndicator, // Export for use in other modules
    QueueHealthIndicator, // Export for use in other modules
  ],
})
export class HealthModule {}
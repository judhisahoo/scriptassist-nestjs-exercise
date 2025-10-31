import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Metrics module for application monitoring and observability
 * Provides Prometheus-compatible metrics collection and exposition
 * Includes HTTP, cache, queue, database, and business logic metrics
 */
@Module({
  controllers: [MetricsController], // Exposes /metrics endpoint for Prometheus scraping
  providers: [MetricsService], // Core metrics collection service
  exports: [MetricsService], // Export for use in other modules
})
export class MetricsModule {}
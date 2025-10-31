import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

/**
 * Metrics controller providing Prometheus-compatible metrics endpoint
 * Exposes application and system metrics for monitoring and alerting
 * Follows Prometheus exposition format standards
 */
@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Get all Prometheus metrics in text format
   * Returns comprehensive metrics including HTTP, cache, queue, database, and system metrics
   * Endpoint designed for Prometheus scraping with proper content-type headers
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Get Prometheus metrics' })
  @ApiResponse({
    status: 200,
    description: 'Prometheus metrics in text format',
    content: {
      'text/plain': {
        schema: { type: 'string' },
      },
    },
  })
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
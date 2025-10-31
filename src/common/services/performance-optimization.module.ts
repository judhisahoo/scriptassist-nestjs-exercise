import { Module, Global } from '@nestjs/common';
import { PerformanceOptimizationService } from './performance-optimization.service';
import { ResourceManagerService } from './resource-manager.service';
import { LoadBalancerService } from './load-balancer.service';
import { AdvancedCacheService } from './advanced-cache.service';
import { RateLimiterService } from './rate-limiter.service';
import { AsyncProcessorService } from './async-processor.service';
import { PerformanceMonitorService } from './performance-monitor.service';
import { DatabaseOptimizerService } from './database-optimizer.service';
import { CacheService } from './cache.service';

/**
 * Global module that provides comprehensive performance optimization services.
 * This module aggregates all performance-related services into a single, globally available module.
 *
 * @remarks
 * This module includes:
 * - Performance monitoring and alerting
 * - Resource management and optimization
 * - Load balancing and traffic distribution
 * - Advanced caching strategies
 * - Rate limiting and traffic control
 * - Asynchronous processing capabilities
 * - Database optimization and query monitoring
 * - General caching services
 *
 * All services are registered as global providers, making them available throughout the application
 * without requiring explicit imports in other modules.
 */
@Global()
@Module({
  /** Array of service providers for performance optimization */
  providers: [
    PerformanceOptimizationService,
    ResourceManagerService,
    LoadBalancerService,
    AdvancedCacheService,
    RateLimiterService,
    AsyncProcessorService,
    PerformanceMonitorService,
    DatabaseOptimizerService,
    CacheService,
  ],
  /** Services exported by this module for use in other parts of the application */
  exports: [
    PerformanceOptimizationService,
    ResourceManagerService,
    LoadBalancerService,
    AdvancedCacheService,
    RateLimiterService,
    AsyncProcessorService,
    PerformanceMonitorService,
    DatabaseOptimizerService,
    CacheService,
  ],
})
export class PerformanceOptimizationModule {}
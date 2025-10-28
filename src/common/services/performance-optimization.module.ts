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

@Global()
@Module({
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
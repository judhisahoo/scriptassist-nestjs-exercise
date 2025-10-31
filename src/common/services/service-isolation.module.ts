/**
 * Global module that provides service isolation and resilience capabilities.
 * Aggregates all fault tolerance, circuit breaking, and self-healing services into a cohesive module.
 *
 * @remarks
 * This module provides:
 * - Circuit breaker pattern implementation for external service calls
 * - Graceful degradation capabilities for system overload scenarios
 * - Self-healing services with automatic health monitoring and recovery
 * - Fault isolation to prevent cascading failures
 * - Retry mechanisms with exponential backoff
 * - Distributed locking for coordinated operations
 * - System health monitoring and reporting
 */
import { Module, Global } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { GracefulDegradationService } from './graceful-degradation.service';
import { SelfHealingService } from './self-healing.service';
import { FaultIsolationService } from './fault-isolation.service';
import { RetryService } from './retry.service';
import { DistributedLockService } from './distributed-lock.service';
import { SystemHealthController } from '../health/system-health.controller';

@Global()
@Module({
  providers: [
    CircuitBreakerService,
    GracefulDegradationService,
    SelfHealingService,
    FaultIsolationService,
    RetryService,
    DistributedLockService,
  ],
  controllers: [SystemHealthController],
  exports: [
    CircuitBreakerService,
    GracefulDegradationService,
    SelfHealingService,
    FaultIsolationService,
    RetryService,
    DistributedLockService,
  ],
})
export class ServiceIsolationModule {}
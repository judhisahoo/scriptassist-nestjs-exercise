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
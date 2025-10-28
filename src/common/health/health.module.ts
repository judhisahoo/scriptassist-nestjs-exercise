import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { CacheHealthIndicator } from './cache-health.indicator';
import { QueueHealthIndicator } from './queue-health.indicator';
import { CacheService } from '../services/cache.service';

@Module({
  imports: [
    TerminusModule,
    BullModule.registerQueue({
      name: 'task-processing',
    }),
  ],
  controllers: [HealthController],
  providers: [CacheHealthIndicator, QueueHealthIndicator, CacheService],
  exports: [CacheHealthIndicator, QueueHealthIndicator],
})
export class HealthModule {}
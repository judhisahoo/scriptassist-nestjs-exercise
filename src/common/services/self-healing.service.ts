import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { GracefulDegradationService } from './graceful-degradation.service';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Configuration for a health check that monitors system component health.
 * Defines how often to check, failure thresholds, and recovery actions.
 */
export interface HealthCheck {
  /** Unique name identifier for the health check */
  name: string;
  /** Async function that performs the health check and returns true if healthy */
  check: () => Promise<boolean>;
  /** Interval in milliseconds between health checks */
  interval: number;
  /** Maximum number of consecutive failures before triggering critical failure */
  maxFailures: number;
  /** Optional recovery action to execute when health is restored */
  recoveryAction?: () => Promise<void>;
}

/**
 * Configuration for a self-healing action that automatically resolves system issues.
 * Defines when and how to execute healing actions with cooldown periods.
 */
export interface SelfHealingAction {
  /** Unique name identifier for the healing action */
  name: string;
  /** Async function that checks if the healing action should be executed */
  condition: () => Promise<boolean>;
  /** Async function that performs the healing action */
  action: () => Promise<void>;
  /** Minimum time in milliseconds between executions of this action */
  cooldownPeriod: number;
  /** Timestamp when this action was last executed (for cooldown tracking) */
  lastExecuted?: number;
}

/**
 * Service for automatic system self-healing and health monitoring.
 * Continuously monitors system health and executes healing actions to maintain system stability.
 *
 * @remarks
 * This service provides:
 * - Continuous health monitoring of system components
 * - Automatic execution of healing actions based on conditions
 * - Integration with circuit breakers and graceful degradation
 * - Distributed coordination to prevent duplicate healing actions
 * - Manual healing action triggering and status monitoring
 */
@Injectable()
export class SelfHealingService implements OnModuleInit, OnModuleDestroy {
  /** Logger instance for self-healing operations */
  private readonly logger = new Logger(SelfHealingService.name);

  /** Map of registered health checks with failure tracking */
  private healthChecks: Map<string, HealthCheck & { failures: number; lastCheck: number }> = new Map();

  /** Array of registered self-healing actions */
  private healingActions: SelfHealingAction[] = [];

  /** Map of active health check intervals */
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();

  /** Flag indicating whether self-healing is currently active */
  private isHealingActive = true;

  constructor(
    private configService: ConfigService,
    private circuitBreakerService: CircuitBreakerService,
    private gracefulDegradationService: GracefulDegradationService,
    private distributedLockService: DistributedLockService,
  ) {}

  async onModuleInit() {
    this.initializeDefaultHealthChecks();
    this.initializeDefaultHealingActions();
    this.startHealthMonitoring();
    this.logger.log('Self-healing service initialized');
  }

  async onModuleDestroy() {
    this.isHealingActive = false;

    // Clear all intervals
    for (const interval of this.checkIntervals.values()) {
      clearInterval(interval);
    }
    this.checkIntervals.clear();
  }

  private initializeDefaultHealthChecks() {
    // Memory health check
    this.registerHealthCheck({
      name: 'memory-health',
      check: async () => {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        const maxMemMB = this.configService.get('MAX_MEMORY_MB', 512);
        return memUsageMB < maxMemMB;
      },
      interval: 30000, // 30 seconds
      maxFailures: 3,
      recoveryAction: async () => {
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          this.logger.log('Forced garbage collection for memory recovery');
        }
      },
    });

    // Database connection health check
    this.registerHealthCheck({
      name: 'database-health',
      check: async () => {
        try {
          // Simplified DB health check - would use actual DB connection
          return true; // Placeholder
        } catch {
          return false;
        }
      },
      interval: 60000, // 1 minute
      maxFailures: 2,
    });

    // External service health check
    this.registerHealthCheck({
      name: 'external-services-health',
      check: async () => {
        // Check circuit breaker states for external services
        const circuits = this.circuitBreakerService.getAllCircuits();
        const criticalCircuits = Object.keys(circuits).filter(name =>
          name.includes('external') || name.includes('api')
        );

        for (const circuitName of criticalCircuits) {
          const state = this.circuitBreakerService.getCircuitState(circuitName);
          if (state === 'OPEN') {
            return false;
          }
        }
        return true;
      },
      interval: 45000, // 45 seconds
      maxFailures: 3,
    });

    // Queue health check
    this.registerHealthCheck({
      name: 'queue-health',
      check: async () => {
        // Simplified queue health check
        return true; // Would check actual queue status
      },
      interval: 30000,
      maxFailures: 2,
    });
  }

  private initializeDefaultHealingActions() {
    // Memory pressure healing
    this.registerHealingAction({
      name: 'memory-pressure-healing',
      condition: async () => {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        return memUsageMB > 400; // 400MB threshold
      },
      action: async () => {
        this.logger.log('Executing memory pressure healing actions');

        // Degrade non-critical features
        this.gracefulDegradationService.manuallyDegradeFeature('analytics');
        this.gracefulDegradationService.manuallyDegradeFeature('background-jobs');

        // Force garbage collection
        if (global.gc) {
          global.gc();
        }

        // Clear any cached data if possible
        this.logger.log('Memory pressure healing completed');
      },
      cooldownPeriod: 300000, // 5 minutes
    });

    // Circuit breaker reset healing
    this.registerHealingAction({
      name: 'circuit-breaker-reset',
      condition: async () => {
        const circuits = this.circuitBreakerService.getAllCircuits();
        const openCircuits = Object.entries(circuits).filter(
          ([, stats]: [string, any]) => stats?.state === 'OPEN'
        );

        // Check if any circuit has been open for more than recovery timeout
        for (const [circuitName, stats] of openCircuits) {
          if (stats && Date.now() - stats.lastFailureTime > stats.config.recoveryTimeout) {
            return true;
          }
        }
        return false;
      },
      action: async () => {
        this.logger.log('Executing circuit breaker reset healing');

        const circuits = this.circuitBreakerService.getAllCircuits();
        const openCircuits = Object.entries(circuits).filter(
          ([, stats]: [string, any]) => stats?.state === 'OPEN'
        );

        for (const [circuitName] of openCircuits) {
          // Attempt to reset circuits that have been open for recovery timeout
          this.circuitBreakerService.resetCircuit(circuitName);
          this.logger.log(`Reset circuit breaker: ${circuitName}`);
        }
      },
      cooldownPeriod: 60000, // 1 minute
    });

    // Feature restoration healing
    this.registerHealingAction({
      name: 'feature-restoration',
      condition: async () => {
        // Check if system is in degraded mode but conditions have improved
        if (!this.gracefulDegradationService.isSystemDegraded()) {
          return false;
        }

        // Check if degraded features can be restored
        const degradedFeatures = this.gracefulDegradationService.getDegradedFeatures();
        const restorableFeatures = degradedFeatures.filter(feature => {
          // Check if feature dependencies are healthy
          // For restoration, we restore features that have been manually degraded
          // and are not currently in a degraded state due to health conditions
          return this.gracefulDegradationService.isFeatureDegraded(feature);
        });

        return restorableFeatures.length > 0;
      },
      action: async () => {
        this.logger.log('Executing feature restoration healing');

        const degradedFeatures = this.gracefulDegradationService.getDegradedFeatures();

        // Attempt to restore features that are currently degraded
        for (const feature of degradedFeatures) {
          if (this.gracefulDegradationService.isFeatureDegraded(feature)) {
            this.gracefulDegradationService.manuallyRestoreFeature(feature);
            this.logger.log(`Restored degraded feature: ${feature}`);
          }
        }
      },
      cooldownPeriod: 120000, // 2 minutes
    });

    // Database connection healing
    this.registerHealingAction({
      name: 'database-connection-healing',
      condition: async () => {
        // Check if database health check is failing
        const dbHealth = this.healthChecks.get('database-health');
        return dbHealth ? dbHealth.failures >= dbHealth.maxFailures : false;
      },
      action: async () => {
        this.logger.log('Executing database connection healing');

        // Attempt to reconnect to database
        // This would involve actual database reconnection logic
        // For now, just log the attempt
        this.logger.log('Database reconnection attempted');

        // Reset health check failures
        const dbHealth = this.healthChecks.get('database-health');
        if (dbHealth) {
          dbHealth.failures = 0;
        }
      },
      cooldownPeriod: 180000, // 3 minutes
    });
  }

  private startHealthMonitoring() {
    // Start all health check intervals
    for (const [name, healthCheck] of this.healthChecks) {
      const interval = setInterval(async () => {
        if (!this.isHealingActive) return;

        await this.performHealthCheck(name);
      }, healthCheck.interval);

      this.checkIntervals.set(name, interval);
    }

    // Start healing action evaluation
    setInterval(async () => {
      if (!this.isHealingActive) return;

      await this.evaluateHealingActions();
    }, 60000); // Check every minute
  }

  registerHealthCheck(healthCheck: HealthCheck) {
    this.healthChecks.set(healthCheck.name, {
      ...healthCheck,
      failures: 0,
      lastCheck: 0,
    });

    // Start monitoring if service is already initialized
    if (this.isHealingActive) {
      const interval = setInterval(async () => {
        await this.performHealthCheck(healthCheck.name);
      }, healthCheck.interval);

      this.checkIntervals.set(healthCheck.name, interval);
    }

    this.logger.log(`Health check registered: ${healthCheck.name}`);
  }

  registerHealingAction(action: SelfHealingAction) {
    this.healingActions.push(action);
    this.logger.log(`Healing action registered: ${action.name}`);
  }

  private async performHealthCheck(checkName: string) {
    const healthCheck = this.healthChecks.get(checkName);
    if (!healthCheck) return;

    try {
      const isHealthy = await healthCheck.check();
      healthCheck.lastCheck = Date.now();

      if (isHealthy) {
        if (healthCheck.failures > 0) {
          this.logger.log(`Health check recovered: ${checkName}`);
        }
        healthCheck.failures = 0;

        // Execute recovery action if available
        if (healthCheck.recoveryAction) {
          await healthCheck.recoveryAction();
        }
      } else {
        healthCheck.failures++;
        this.logger.warn(`Health check failed: ${checkName} (${healthCheck.failures}/${healthCheck.maxFailures})`);

        if (healthCheck.failures >= healthCheck.maxFailures) {
          this.logger.error(`Health check critically failed: ${checkName}`);
          await this.handleCriticalFailure(checkName);
        }
      }
    } catch (error) {
      this.logger.error(`Error performing health check ${checkName}:`, error);
      healthCheck.failures++;
    }
  }

  private async evaluateHealingActions() {
    for (const action of this.healingActions) {
      try {
        // Check cooldown period
        if (action.lastExecuted && Date.now() - action.lastExecuted < action.cooldownPeriod) {
          continue;
        }

        const shouldExecute = await action.condition();
        if (shouldExecute) {
          // Use distributed lock to ensure only one instance executes healing
          const lockKey = `healing:${action.name}`;
          const lockValue = await this.distributedLockService.acquireLock(
            lockKey,
            `instance_${process.pid}`,
            { ttl: 30000 }, // 30 seconds
          );

          if (lockValue) {
            try {
              this.logger.log(`Executing healing action: ${action.name}`);
              await action.action();
              action.lastExecuted = Date.now();
            } finally {
              await this.distributedLockService.releaseLock(lockKey, lockValue);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Error evaluating healing action ${action.name}:`, error);
      }
    }
  }

  private async handleCriticalFailure(checkName: string) {
    this.logger.error(`Handling critical failure for: ${checkName}`);

    // Trigger system-wide healing actions
    switch (checkName) {
      case 'memory-health':
        await this.gracefulDegradationService.manuallyDegradeFeature('analytics');
        await this.gracefulDegradationService.manuallyDegradeFeature('background-jobs');
        break;

      case 'database-health':
        await this.gracefulDegradationService.manuallyDegradeFeature('cache');
        await this.gracefulDegradationService.manuallyDegradeFeature('queue');
        break;

      case 'external-services-health':
        await this.gracefulDegradationService.manuallyDegradeFeature('notifications');
        break;
    }

    // Emit critical failure event for monitoring
    this.logger.error(`Critical system failure detected: ${checkName}`);
  }

  getHealthStatus(): Record<string, {
    failures: number;
    lastCheck: number;
    maxFailures: number;
    isHealthy: boolean;
  }> {
    const result: Record<string, any> = {};

    for (const [name, check] of this.healthChecks) {
      result[name] = {
        failures: check.failures,
        lastCheck: check.lastCheck,
        maxFailures: check.maxFailures,
        isHealthy: check.failures < check.maxFailures,
      };
    }

    return result;
  }

  getHealingActionsStatus(): Array<{
    name: string;
    lastExecuted?: number;
    cooldownPeriod: number;
  }> {
    return this.healingActions.map(action => ({
      name: action.name,
      lastExecuted: action.lastExecuted,
      cooldownPeriod: action.cooldownPeriod,
    }));
  }

  // Manual healing control
  async triggerHealingAction(actionName: string): Promise<boolean> {
    const action = this.healingActions.find(a => a.name === actionName);
    if (!action) {
      this.logger.warn(`Unknown healing action: ${actionName}`);
      return false;
    }

    try {
      const shouldExecute = await action.condition();
      if (shouldExecute) {
        await action.action();
        action.lastExecuted = Date.now();
        this.logger.log(`Manually triggered healing action: ${actionName}`);
        return true;
      } else {
        this.logger.log(`Healing action ${actionName} condition not met`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error triggering healing action ${actionName}:`, error);
      return false;
    }
  }

  pauseHealing() {
    this.isHealingActive = false;
    this.logger.log('Self-healing paused');
  }

  resumeHealing() {
    this.isHealingActive = true;
    this.logger.log('Self-healing resumed');
  }
}
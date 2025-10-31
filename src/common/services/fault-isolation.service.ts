import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { GracefulDegradationService } from './graceful-degradation.service';
import { SelfHealingService } from './self-healing.service';

/**
 * Defines a service boundary for fault isolation.
 * Service boundaries group related functionality and define isolation strategies.
 */
export interface ServiceBoundary {
  /** Unique name identifier for the service boundary */
  name: string;
  /** Type of service boundary */
  type: 'internal' | 'external' | 'infrastructure';
  /** List of service dependencies that this boundary relies on */
  dependencies: string[];
  /** Level of isolation to apply to this boundary */
  isolationLevel: 'none' | 'thread' | 'process' | 'container';
  /** Optional circuit breaker name for this boundary */
  circuitBreaker?: string;
  /** Timeout in milliseconds for operations in this boundary */
  timeout: number;
  /** Optional retry policy for failed operations */
  retryPolicy?: {
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Multiplier for exponential backoff between retries */
    backoffMultiplier: number;
    /** Initial delay in milliseconds before first retry */
    initialDelay: number;
  };
}

/**
 * Defines a fault domain for grouping related services and defining failure handling strategies.
 * Fault domains allow coordinated isolation and recovery of service groups.
 */
export interface FaultDomain {
  /** Unique name identifier for the fault domain */
  name: string;
  /** List of service boundary names included in this domain */
  services: string[];
  /** Number of failures before triggering isolation */
  failureThreshold: number;
  /** Strategy to use when isolating the domain */
  isolationStrategy: 'fail-fast' | 'degrade' | 'isolate';
  /** Strategy for recovering the domain after isolation */
  recoveryStrategy: 'automatic' | 'manual' | 'circuit-breaker';
}

/**
 * Service for implementing fault isolation patterns in distributed systems.
 * Provides service boundaries, fault domains, and coordinated failure handling
 * to prevent cascading failures and enable graceful degradation.
 *
 * @remarks
 * This service supports:
 * - Service boundary isolation with configurable levels
 * - Fault domain grouping for coordinated failure handling
 * - Circuit breaker integration for automatic failure detection
 * - Graceful degradation coordination
 * - Automatic and manual recovery strategies
 */
@Injectable()
export class FaultIsolationService implements OnModuleInit {
  /** Logger instance for fault isolation operations */
  private readonly logger = new Logger(FaultIsolationService.name);

  /** Map of registered service boundaries by name */
  private serviceBoundaries: Map<string, ServiceBoundary> = new Map();

  /** Map of registered fault domains by name */
  private faultDomains: Map<string, FaultDomain> = new Map();

  /** Map tracking failure counts and timestamps for each fault domain */
  private domainFailures: Map<string, { count: number; lastFailure: number }> = new Map();

  /**
   * Creates an instance of FaultIsolationService.
   *
   * @param configService - Service for accessing application configuration
   * @param circuitBreakerService - Service for circuit breaker functionality
   * @param gracefulDegradationService - Service for graceful degradation features
   * @param selfHealingService - Service for self-healing capabilities
   */
  constructor(
    private configService: ConfigService,
    private circuitBreakerService: CircuitBreakerService,
    private gracefulDegradationService: GracefulDegradationService,
    private selfHealingService: SelfHealingService,
  ) {}

  async onModuleInit() {
    this.initializeDefaultBoundaries();
    this.initializeDefaultDomains();
    this.startFaultMonitoring();
    this.logger.log('Fault isolation service initialized');
  }

  private initializeDefaultBoundaries() {
    // Database boundary
    this.registerServiceBoundary({
      name: 'database',
      type: 'infrastructure',
      dependencies: [],
      isolationLevel: 'process',
      circuitBreaker: 'database-circuit',
      timeout: 30000,
      retryPolicy: {
        maxAttempts: 3,
        backoffMultiplier: 2,
        initialDelay: 1000,
      },
    });

    // Cache boundary
    this.registerServiceBoundary({
      name: 'cache',
      type: 'infrastructure',
      dependencies: [],
      isolationLevel: 'thread',
      circuitBreaker: 'cache-circuit',
      timeout: 5000,
      retryPolicy: {
        maxAttempts: 2,
        backoffMultiplier: 1.5,
        initialDelay: 500,
      },
    });

    // Queue boundary
    this.registerServiceBoundary({
      name: 'queue',
      type: 'infrastructure',
      dependencies: [],
      isolationLevel: 'process',
      circuitBreaker: 'queue-circuit',
      timeout: 10000,
    });

    // External API boundary
    this.registerServiceBoundary({
      name: 'external-api',
      type: 'external',
      dependencies: [],
      isolationLevel: 'container',
      circuitBreaker: 'external-api-circuit',
      timeout: 15000,
      retryPolicy: {
        maxAttempts: 2,
        backoffMultiplier: 2,
        initialDelay: 2000,
      },
    });

    // Notification service boundary
    this.registerServiceBoundary({
      name: 'notifications',
      type: 'external',
      dependencies: ['external-api'],
      isolationLevel: 'thread',
      circuitBreaker: 'notification-circuit',
      timeout: 10000,
    });

    // Task processing boundary
    this.registerServiceBoundary({
      name: 'task-processing',
      type: 'internal',
      dependencies: ['database', 'queue', 'cache'],
      isolationLevel: 'thread',
      timeout: 30000,
    });

    // Authentication boundary
    this.registerServiceBoundary({
      name: 'auth',
      type: 'internal',
      dependencies: ['database', 'cache'],
      isolationLevel: 'thread',
      timeout: 5000,
    });
  }

  private initializeDefaultDomains() {
    // Core domain - most critical
    this.registerFaultDomain({
      name: 'core',
      services: ['database', 'auth', 'task-processing'],
      failureThreshold: 2,
      isolationStrategy: 'fail-fast',
      recoveryStrategy: 'automatic',
    });

    // Infrastructure domain
    this.registerFaultDomain({
      name: 'infrastructure',
      services: ['cache', 'queue'],
      failureThreshold: 3,
      isolationStrategy: 'degrade',
      recoveryStrategy: 'circuit-breaker',
    });

    // External services domain
    this.registerFaultDomain({
      name: 'external',
      services: ['external-api', 'notifications'],
      failureThreshold: 2,
      isolationStrategy: 'isolate',
      recoveryStrategy: 'circuit-breaker',
    });

    // Background processing domain
    this.registerFaultDomain({
      name: 'background',
      services: ['task-processing'],
      failureThreshold: 1,
      isolationStrategy: 'degrade',
      recoveryStrategy: 'manual',
    });
  }

  private startFaultMonitoring() {
    // Monitor faults every 30 seconds
    setInterval(async () => {
      await this.monitorFaultDomains();
    }, 30000);

    // Initial monitoring
    setTimeout(() => {
      this.monitorFaultDomains();
    }, 10000);
  }

  /**
   * Registers a new service boundary for fault isolation.
   * Service boundaries define isolation levels and failure handling strategies.
   *
   * @param boundary - The service boundary configuration to register
   * @remarks
   * Automatically registers associated circuit breakers if specified in the boundary configuration.
   */
  registerServiceBoundary(boundary: ServiceBoundary) {
    this.serviceBoundaries.set(boundary.name, boundary);

    // Register circuit breaker if specified
    if (boundary.circuitBreaker) {
      this.circuitBreakerService.registerCircuit(boundary.circuitBreaker, {
        failureThreshold: 5,
        recoveryTimeout: 60000,
        monitoringPeriod: 10000,
        successThreshold: 3,
      });
    }

    this.logger.log(`Service boundary registered: ${boundary.name} (${boundary.isolationLevel} isolation)`);
  }

  /**
   * Registers a new fault domain for coordinated failure handling.
   * Fault domains group related services and define failure thresholds and recovery strategies.
   *
   * @param domain - The fault domain configuration to register
   * @remarks
   * Initializes failure tracking for the domain with zero initial failure count.
   */
  registerFaultDomain(domain: FaultDomain) {
    this.faultDomains.set(domain.name, domain);
    this.domainFailures.set(domain.name, { count: 0, lastFailure: 0 });
    this.logger.log(`Fault domain registered: ${domain.name} (${domain.services.length} services)`);
  }

  /**
   * Executes an operation within a specified service boundary with fault isolation controls.
   * Applies timeout, retry, circuit breaker, and fallback mechanisms based on boundary configuration.
   *
   * @param boundaryName - Name of the service boundary to execute within
   * @param operation - The async operation to execute
   * @param options - Execution options overriding boundary defaults
   * @returns The result of the operation
   * @throws Error if boundary is unknown or isolated, or if operation fails without fallback
   */
  async executeInBoundary<T>(
    boundaryName: string,
    operation: () => Promise<T>,
    options: {
      /** Whether to use circuit breaker protection */
      useCircuitBreaker?: boolean;
      /** Whether to apply timeout controls */
      useTimeout?: boolean;
      /** Whether to use retry logic */
      useRetry?: boolean;
      /** Fallback function to execute on failure */
      fallback?: () => Promise<T>;
    } = {},
  ): Promise<T> {
    const boundary = this.serviceBoundaries.get(boundaryName);
    if (!boundary) {
      throw new Error(`Unknown service boundary: ${boundaryName}`);
    }

    const {
      useCircuitBreaker = !!boundary.circuitBreaker,
      useTimeout = true,
      useRetry = !!boundary.retryPolicy,
      fallback,
    } = options;

    // Check if boundary is isolated
    if (await this.isBoundaryIsolated(boundaryName)) {
      if (fallback) {
        this.logger.warn(`Boundary ${boundaryName} is isolated, using fallback`);
        return fallback();
      }
      throw new Error(`Service boundary ${boundaryName} is isolated`);
    }

    // Execute with circuit breaker if enabled
    if (useCircuitBreaker && boundary.circuitBreaker) {
      return this.circuitBreakerService.execute(
        boundary.circuitBreaker,
        async () => this.executeWithBoundaryControls(boundary, operation, { useTimeout, useRetry }),
        fallback,
      );
    }

    // Execute without circuit breaker
    return this.executeWithBoundaryControls(boundary, operation, { useTimeout, useRetry, fallback });
  }

  private async executeWithBoundaryControls<T>(
    boundary: ServiceBoundary,
    operation: () => Promise<T>,
    options: {
      useTimeout?: boolean;
      useRetry?: boolean;
      fallback?: () => Promise<T>;
    },
  ): Promise<T> {
    const { useTimeout = true, useRetry = false, fallback } = options;

    let lastError: Error;

    // Retry logic
    const maxAttempts = useRetry && boundary.retryPolicy ? boundary.retryPolicy.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let timeoutHandle: NodeJS.Timeout | undefined;

        // Set timeout if enabled
        if (useTimeout) {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Operation timeout in boundary ${boundary.name}`));
            }, boundary.timeout);
          });

          const operationPromise = operation();

          const result = await Promise.race([operationPromise, timeoutPromise]);

          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          return result;
        } else {
          return await operation();
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt}/${maxAttempts} failed in boundary ${boundary.name}:`, error);

        // Record failure for fault domain monitoring
        await this.recordBoundaryFailure(boundary.name);

        if (attempt < maxAttempts && useRetry && boundary.retryPolicy) {
          // Calculate delay with exponential backoff
          const delay = boundary.retryPolicy.initialDelay *
            Math.pow(boundary.retryPolicy.backoffMultiplier, attempt - 1);

          await this.delay(delay);
        }
      }
    }

    // All attempts failed
    if (fallback) {
      this.logger.warn(`All attempts failed in boundary ${boundary.name}, using fallback`);
      return fallback();
    }

    throw lastError!;
  }

  private async recordBoundaryFailure(boundaryName: string) {
    // Find domains containing this boundary
    for (const [domainName, domain] of this.faultDomains) {
      if (domain.services.includes(boundaryName)) {
        const domainFailure = this.domainFailures.get(domainName)!;
        domainFailure.count++;
        domainFailure.lastFailure = Date.now();

        // Check if domain failure threshold is exceeded
        if (domainFailure.count >= domain.failureThreshold) {
          await this.isolateFaultDomain(domainName);
        }
      }
    }
  }

  private async isolateFaultDomain(domainName: string) {
    const domain = this.faultDomains.get(domainName);
    if (!domain) return;

    this.logger.error(`Isolating fault domain: ${domainName} (${domain.isolationStrategy})`);

    switch (domain.isolationStrategy) {
      case 'fail-fast':
        // Immediately fail all operations in this domain
        for (const service of domain.services) {
          const boundary = this.serviceBoundaries.get(service);
          if (boundary?.circuitBreaker) {
            // Force circuit breaker to open
            // This would require extending CircuitBreakerService
            this.logger.error(`Service ${service} in domain ${domainName} isolated (fail-fast)`);
          }
        }
        break;

      case 'degrade':
        // Degrade features dependent on this domain
        for (const service of domain.services) {
          this.gracefulDegradationService.manuallyDegradeFeature(service);
        }
        this.logger.warn(`Domain ${domainName} degraded`);
        break;

      case 'isolate':
        // Mark services as isolated
        for (const service of domain.services) {
          // This would require additional isolation logic
          this.logger.warn(`Service ${service} in domain ${domainName} isolated`);
        }
        break;
    }

    // Trigger recovery based on domain strategy
    switch (domain.recoveryStrategy) {
      case 'automatic':
        // Schedule automatic recovery
        setTimeout(async () => {
          await this.attemptDomainRecovery(domainName);
        }, 300000); // 5 minutes
        break;

      case 'circuit-breaker':
        // Let circuit breakers handle recovery
        this.logger.log(`Domain ${domainName} recovery delegated to circuit breakers`);
        break;

      case 'manual':
        // Require manual intervention
        this.logger.error(`Domain ${domainName} requires manual recovery`);
        break;
    }
  }

  private async attemptDomainRecovery(domainName: string) {
    const domain = this.faultDomains.get(domainName);
    if (!domain) return;

    this.logger.log(`Attempting automatic recovery for domain: ${domainName}`);

    // Reset failure count
    const domainFailure = this.domainFailures.get(domainName);
    if (domainFailure) {
      domainFailure.count = 0;
    }

    // Restore degraded features
    for (const service of domain.services) {
      this.gracefulDegradationService.manuallyRestoreFeature(service);
    }

    // Trigger self-healing
    await this.selfHealingService.triggerHealingAction('feature-restoration');

    this.logger.log(`Domain ${domainName} recovery attempted`);
  }

  private async isBoundaryIsolated(boundaryName: string): Promise<boolean> {
    // Check if any domain containing this boundary is isolated
    for (const [domainName, domain] of this.faultDomains) {
      if (domain.services.includes(boundaryName)) {
        const domainFailure = this.domainFailures.get(domainName);
        if (domainFailure && domainFailure.count >= domain.failureThreshold) {
          return true;
        }
      }
    }
    return false;
  }

  private async monitorFaultDomains() {
    const now = Date.now();

    // Reset old failure counts (older than 10 minutes)
    for (const [domainName, domainFailure] of this.domainFailures) {
      if (now - domainFailure.lastFailure > 600000) { // 10 minutes
        domainFailure.count = Math.max(0, domainFailure.count - 1);
      }
    }
  }

  getBoundaryStatus(): Record<string, {
    isolated: boolean;
    circuitBreakerState?: string;
    lastFailure?: number;
  }> {
    const result: Record<string, any> = {};

    for (const [name, boundary] of this.serviceBoundaries) {
      const isolated = this.isBoundaryIsolated(name);
      const circuitState = boundary.circuitBreaker
        ? this.circuitBreakerService.getCircuitState(boundary.circuitBreaker)
        : undefined;

      result[name] = {
        isolated,
        circuitBreakerState: circuitState,
      };
    }

    return result;
  }

  getDomainStatus(): Record<string, {
    failureCount: number;
    lastFailure: number;
    threshold: number;
    isolated: boolean;
  }> {
    const result: Record<string, any> = {};

    for (const [name, domain] of this.faultDomains) {
      const domainFailure = this.domainFailures.get(name)!;

      result[name] = {
        failureCount: domainFailure.count,
        lastFailure: domainFailure.lastFailure,
        threshold: domain.failureThreshold,
        isolated: domainFailure.count >= domain.failureThreshold,
      };
    }

    return result;
  }

  // Manual control methods
  async manuallyIsolateBoundary(boundaryName: string) {
    const boundary = this.serviceBoundaries.get(boundaryName);
    if (boundary?.circuitBreaker) {
      // This would require extending CircuitBreakerService to support manual isolation
      this.logger.warn(`Manually isolated boundary: ${boundaryName}`);
    }
  }

  async manuallyRestoreBoundary(boundaryName: string) {
    // Reset failure counts for domains containing this boundary
    for (const [domainName, domain] of this.faultDomains) {
      if (domain.services.includes(boundaryName)) {
        const domainFailure = this.domainFailures.get(domainName);
        if (domainFailure) {
          domainFailure.count = 0;
        }
      }
    }

    this.logger.log(`Manually restored boundary: ${boundaryName}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
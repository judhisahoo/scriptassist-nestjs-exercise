import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Defines a feature that can be gracefully degraded during system stress.
 * Features have priorities and dependencies that affect degradation order.
 */
export interface DegradationFeature {
  /** Unique name identifier for the feature */
  name: string;
  /** Whether the feature is currently enabled */
  enabled: boolean;
  /** Whether a fallback is available when the feature is degraded */
  fallbackAvailable: boolean;
  /** Priority level (higher numbers degrade last) */
  priority: number;
  /** Optional list of features this feature depends on */
  dependencies?: string[];
}

/**
 * Defines a strategy for graceful degradation based on system conditions.
 * Strategies evaluate conditions and determine which features to disable.
 */
export interface DegradationStrategy {
  /** Unique name identifier for the strategy */
  name: string;
  /** Condition function that determines when to apply this strategy */
  condition: () => Promise<boolean> | boolean;
  /** List of feature names to disable when this strategy is active */
  featuresToDisable: string[];
  /** Human-readable description of the strategy */
  description: string;
}

/**
 * Service for implementing graceful degradation patterns in distributed systems.
 * Automatically disables non-critical features during system stress to maintain core functionality.
 *
 * @remarks
 * This service supports:
 * - Feature prioritization and dependency management
 * - Automatic degradation based on system conditions (memory, CPU, etc.)
 * - Manual degradation control for operational needs
 * - Fallback execution patterns for degraded features
 * - Real-time monitoring and recovery detection
 */
@Injectable()
export class GracefulDegradationService implements OnModuleInit {
  /** Logger instance for degradation operations */
  private readonly logger = new Logger(GracefulDegradationService.name);

  /** Map of registered features by name */
  private features: Map<string, DegradationFeature> = new Map();

  /** Array of registered degradation strategies */
  private strategies: DegradationStrategy[] = [];

  /** Set of currently degraded feature names */
  private degradedFeatures: Set<string> = new Set();

  /** Flag indicating if the system is in degraded mode */
  private isDegradedMode = false;

  /**
   * Creates an instance of GracefulDegradationService.
   *
   * @param configService - Service for accessing application configuration
   */
  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeDefaultFeatures();
    this.initializeDefaultStrategies();
    this.startHealthMonitoring();
  }

  private initializeDefaultFeatures() {
    // Register default features with their priorities
    this.registerFeature({
      name: 'cache',
      enabled: true,
      fallbackAvailable: true,
      priority: 8,
    });

    this.registerFeature({
      name: 'queue',
      enabled: true,
      fallbackAvailable: true,
      priority: 7,
    });

    this.registerFeature({
      name: 'metrics',
      enabled: true,
      fallbackAvailable: true,
      priority: 6,
    });

    this.registerFeature({
      name: 'logging',
      enabled: true,
      fallbackAvailable: false, // Logging should always work
      priority: 10,
    });

    this.registerFeature({
      name: 'database',
      enabled: true,
      fallbackAvailable: false, // Can't really degrade database
      priority: 9,
    });

    this.registerFeature({
      name: 'external-apis',
      enabled: true,
      fallbackAvailable: true,
      priority: 5,
    });

    this.registerFeature({
      name: 'notifications',
      enabled: true,
      fallbackAvailable: true,
      priority: 4,
    });

    this.registerFeature({
      name: 'search',
      enabled: true,
      fallbackAvailable: true,
      priority: 3,
    });

    this.registerFeature({
      name: 'analytics',
      enabled: true,
      fallbackAvailable: true,
      priority: 2,
    });

    this.registerFeature({
      name: 'background-jobs',
      enabled: true,
      fallbackAvailable: true,
      priority: 1,
    });
  }

  private initializeDefaultStrategies() {
    // High memory usage strategy
    this.registerStrategy({
      name: 'high-memory',
      condition: async () => {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        return memUsageMB > 400; // 400MB threshold
      },
      featuresToDisable: ['analytics', 'background-jobs'],
      description: 'Disable non-critical features when memory usage is high',
    });

    // High CPU usage strategy
    this.registerStrategy({
      name: 'high-cpu',
      condition: async () => {
        // Simple CPU check - in production you'd use a proper monitoring library
        return false; // Placeholder
      },
      featuresToDisable: ['search', 'analytics'],
      description: 'Disable CPU-intensive features when CPU usage is high',
    });

    // Database connection issues
    this.registerStrategy({
      name: 'database-issues',
      condition: async () => {
        try {
          // Check database health - simplified
          return false; // Would check actual DB connection
        } catch {
          return true;
        }
      },
      featuresToDisable: ['cache', 'queue'],
      description: 'Disable caching and queuing when database has issues',
    });

    // External service failures
    this.registerStrategy({
      name: 'external-service-failures',
      condition: async () => {
        // Check external service health
        return false; // Would check actual external services
      },
      featuresToDisable: ['notifications', 'analytics'],
      description: 'Disable external integrations when services are failing',
    });

    // Emergency mode - only keep critical features
    this.registerStrategy({
      name: 'emergency',
      condition: async () => {
        // Check for critical system conditions
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        return memUsageMB > 500; // 500MB emergency threshold
      },
      featuresToDisable: ['analytics', 'background-jobs', 'search', 'notifications'],
      description: 'Emergency mode: only keep core functionality',
    });
  }

  private startHealthMonitoring() {
    // Check health every 30 seconds
    setInterval(async () => {
      await this.evaluateDegradationStrategies();
    }, 30000);

    // Initial evaluation
    setTimeout(() => {
      this.evaluateDegradationStrategies();
    }, 5000);
  }

  /**
   * Registers a feature for graceful degradation management.
   * Features can be automatically disabled during system stress based on priority and dependencies.
   *
   * @param feature - The feature configuration to register
   * @remarks
   * Features with higher priority numbers are degraded last.
   * Dependencies are automatically considered during degradation evaluation.
   */
  registerFeature(feature: DegradationFeature) {
    this.features.set(feature.name, feature);
    this.logger.log(`Feature registered for degradation: ${feature.name} (priority: ${feature.priority})`);
  }

  /**
   * Registers a degradation strategy for automatic feature disabling.
   * Strategies define conditions under which features should be degraded.
   *
   * @param strategy - The degradation strategy to register
   * @remarks
   * Strategies are evaluated periodically to determine if features should be degraded.
   */
  registerStrategy(strategy: DegradationStrategy) {
    this.strategies.push(strategy);
    this.logger.log(`Degradation strategy registered: ${strategy.name}`);
  }

  async evaluateDegradationStrategies() {
    const previouslyDegraded = this.isDegradedMode;
    const degradedFeaturesBefore = new Set(this.degradedFeatures);

    // Reset degradation state
    this.degradedFeatures.clear();
    this.isDegradedMode = false;

    // Evaluate each strategy
    for (const strategy of this.strategies) {
      try {
        const shouldDegrade = await strategy.condition();
        if (shouldDegrade) {
          this.isDegradedMode = true;
          strategy.featuresToDisable.forEach(feature => {
            this.degradedFeatures.add(feature);
          });
          this.logger.warn(`Degradation strategy activated: ${strategy.name} - ${strategy.description}`);
        }
      } catch (error) {
        this.logger.error(`Error evaluating strategy ${strategy.name}:`, error);
      }
    }

    // Check for feature dependencies
    this.degradedFeatures.forEach(featureName => {
      const feature = this.features.get(featureName);
      if (feature?.dependencies) {
        feature.dependencies.forEach(dep => {
          if (!this.degradedFeatures.has(dep)) {
            this.logger.warn(`Adding dependency ${dep} to degradation due to ${featureName}`);
            this.degradedFeatures.add(dep);
          }
        });
      }
    });

    // Log changes
    if (previouslyDegraded !== this.isDegradedMode) {
      if (this.isDegradedMode) {
        this.logger.warn(`System entered degraded mode. Degraded features: ${Array.from(this.degradedFeatures).join(', ')}`);
      } else {
        this.logger.log('System recovered from degraded mode');
      }
    }

    const newDegradations = Array.from(this.degradedFeatures).filter(f => !degradedFeaturesBefore.has(f));
    const recoveredFeatures = Array.from(degradedFeaturesBefore).filter(f => !this.degradedFeatures.has(f));

    if (newDegradations.length > 0) {
      this.logger.warn(`New degraded features: ${newDegradations.join(', ')}`);
    }

    if (recoveredFeatures.length > 0) {
      this.logger.log(`Recovered features: ${recoveredFeatures.join(', ')}`);
    }
  }

  isFeatureEnabled(featureName: string): boolean {
    const feature = this.features.get(featureName);
    if (!feature) {
      this.logger.warn(`Unknown feature checked: ${featureName}`);
      return true; // Default to enabled for unknown features
    }

    return !this.degradedFeatures.has(featureName);
  }

  isFeatureDegraded(featureName: string): boolean {
    return this.degradedFeatures.has(featureName);
  }

  isSystemDegraded(): boolean {
    return this.isDegradedMode;
  }

  getDegradedFeatures(): string[] {
    return Array.from(this.degradedFeatures);
  }

  getFeatureStatus(): Record<string, { enabled: boolean; degraded: boolean; priority: number }> {
    const result: Record<string, { enabled: boolean; degraded: boolean; priority: number }> = {};

    for (const [name, feature] of this.features) {
      result[name] = {
        enabled: this.isFeatureEnabled(name),
        degraded: this.isFeatureDegraded(name),
        priority: feature.priority,
      };
    }

    return result;
  }

  // Manual control methods
  manuallyDegradeFeature(featureName: string) {
    if (this.features.has(featureName)) {
      this.degradedFeatures.add(featureName);
      this.isDegradedMode = true;
      this.logger.warn(`Feature manually degraded: ${featureName}`);
    }
  }

  manuallyRestoreFeature(featureName: string) {
    this.degradedFeatures.delete(featureName);
    if (this.degradedFeatures.size === 0) {
      this.isDegradedMode = false;
    }
    this.logger.log(`Feature manually restored: ${featureName}`);
  }

  // Graceful fallback execution
  /**
   * Executes an operation with automatic fallback if the feature is degraded.
   * Provides a convenient way to handle degraded features with alternative implementations.
   *
   * @param featureName - Name of the feature to check
   * @param operation - The primary operation to execute if feature is enabled
   * @param fallback - The fallback operation to execute if feature is degraded
   * @returns The result of either the primary operation or fallback
   */
  async executeWithFallback<T>(
    featureName: string,
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    if (this.isFeatureEnabled(featureName)) {
      try {
        return await operation();
      } catch (error) {
        this.logger.warn(`Feature ${featureName} failed, using fallback:`, error);
        return await fallback();
      }
    } else {
      this.logger.debug(`Feature ${featureName} is degraded, using fallback`);
      return await fallback();
    }
  }
}
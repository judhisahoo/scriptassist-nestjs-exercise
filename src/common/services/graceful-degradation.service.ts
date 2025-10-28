import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DegradationFeature {
  name: string;
  enabled: boolean;
  fallbackAvailable: boolean;
  priority: number; // Higher priority features degrade last
  dependencies?: string[]; // Other features this depends on
}

export interface DegradationStrategy {
  name: string;
  condition: () => Promise<boolean> | boolean;
  featuresToDisable: string[];
  description: string;
}

@Injectable()
export class GracefulDegradationService implements OnModuleInit {
  private readonly logger = new Logger(GracefulDegradationService.name);
  private features: Map<string, DegradationFeature> = new Map();
  private strategies: DegradationStrategy[] = [];
  private degradedFeatures: Set<string> = new Set();
  private isDegradedMode = false;

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

  registerFeature(feature: DegradationFeature) {
    this.features.set(feature.name, feature);
    this.logger.log(`Feature registered for degradation: ${feature.name} (priority: ${feature.priority})`);
  }

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
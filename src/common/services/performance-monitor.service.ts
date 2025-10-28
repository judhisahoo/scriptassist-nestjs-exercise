import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';
import { ResourceManagerService } from './resource-manager.service';
import { DatabaseOptimizerService } from './database-optimizer.service';
import { AdvancedCacheService } from './advanced-cache.service';
import { RateLimiterService } from './rate-limiter.service';
import { AsyncProcessorService } from './async-processor.service';

export interface SystemMetrics {
  timestamp: number;
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
    average: number;
  };
  throughput: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    totalRequests: number;
  };
  errorRates: {
    httpErrors: number;
    databaseErrors: number;
    cacheErrors: number;
    overall: number;
  };
  resourceUsage: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  queueMetrics: {
    activeQueues: number;
    queuedTasks: number;
    processingRate: number;
  };
  cacheMetrics: {
    hitRate: number;
    memoryUsage: number;
    evictionRate: number;
  };
  databaseMetrics: {
    connectionPoolUtilization: number;
    slowQueries: number;
    activeConnections: number;
  };
}

export interface PerformanceAlert {
  id: string;
  type: 'warning' | 'error' | 'critical';
  component: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
}

export interface PerformanceReport {
  period: {
    start: number;
    end: number;
    duration: number;
  };
  summary: {
    averageResponseTime: number;
    totalRequests: number;
    errorRate: number;
    throughput: number;
  };
  bottlenecks: Array<{
    component: string;
    issue: string;
    impact: string;
    recommendation: string;
  }>;
  recommendations: string[];
  alerts: PerformanceAlert[];
}

@Injectable()
export class PerformanceMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PerformanceMonitorService.name);
  private metrics: SystemMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private monitoringInterval: NodeJS.Timeout;
  private reportInterval: NodeJS.Timeout;
  private alertCheckInterval: NodeJS.Timeout;

  // Performance thresholds
  private readonly thresholds = {
    responseTime: {
      warning: 1000, // 1 second
      critical: 5000, // 5 seconds
    },
    errorRate: {
      warning: 5, // 5%
      critical: 15, // 15%
    },
    cpuUsage: {
      warning: 80, // 80%
      critical: 95, // 95%
    },
    memoryUsage: {
      warning: 85, // 85%
      critical: 95, // 95%
    },
    cacheHitRate: {
      warning: 70, // 70%
      critical: 50, // 50%
    },
    queueLength: {
      warning: 100,
      critical: 1000,
    },
  };

  constructor(
    private configService: ConfigService,
    private performanceService: PerformanceOptimizationService,
    private resourceManager: ResourceManagerService,
    private databaseOptimizer: DatabaseOptimizerService,
    private cacheService: AdvancedCacheService,
    private rateLimiter: RateLimiterService,
    private asyncProcessor: AsyncProcessorService,
  ) {}

  async onModuleInit() {
    this.startMonitoring();
    this.startAlertChecking();
    this.startReportGeneration();
    this.logger.log('Performance monitor initialized');
  }

  async onModuleDestroy() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
    }
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
    }
  }

  private startMonitoring() {
    const interval = this.configService.get('PERFORMANCE_MONITORING_INTERVAL', 10000); // 10 seconds

    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
    }, interval);
  }

  private startAlertChecking() {
    this.alertCheckInterval = setInterval(async () => {
      await this.checkAlerts();
    }, 30000); // Every 30 seconds
  }

  private startReportGeneration() {
    // Generate reports every hour
    this.reportInterval = setInterval(async () => {
      await this.generatePerformanceReport();
    }, 3600000); // 1 hour
  }

  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();

      // Collect performance metrics
      const perfMetrics = this.performanceService.getMetrics();

      // Collect resource metrics
      const resourceStatus = this.resourceManager.getResourceStatus();

      // Collect database metrics
      const dbMetrics = this.databaseOptimizer.getDatabaseMetrics();

      // Collect cache metrics
      const cacheStats = this.cacheService.getCacheStatistics();

      // Collect queue metrics
      const queueMetrics = this.asyncProcessor.getQueueMetrics();

      // Collect rate limiter stats
      const rateLimitStats = this.rateLimiter.getStatistics();

      // Calculate percentiles for response time
      const responseTimes = this.metrics.slice(-100).map(m => m.responseTime.average);
      const sortedResponseTimes = responseTimes.sort((a, b) => a - b);

      const p50 = this.calculatePercentile(sortedResponseTimes, 50);
      const p95 = this.calculatePercentile(sortedResponseTimes, 95);
      const p99 = this.calculatePercentile(sortedResponseTimes, 99);

      // Calculate throughput
      const recentMetrics = this.metrics.slice(-6); // Last minute (6 * 10s intervals)
      const totalRequests = recentMetrics.reduce((sum, m) => sum + m.throughput.totalRequests, 0);
      const requestsPerSecond = totalRequests / 60;
      const requestsPerMinute = totalRequests;

      // Calculate error rates
      const recentErrors = recentMetrics.reduce((sum, m) => sum + (m.errorRates.overall * m.throughput.totalRequests / 100), 0);
      const errorRate = totalRequests > 0 ? (recentErrors / totalRequests) * 100 : 0;

      const metrics: SystemMetrics = {
        timestamp,
        responseTime: {
          p50,
          p95,
          p99,
          average: perfMetrics.averageResponseTime,
        },
        throughput: {
          requestsPerSecond,
          requestsPerMinute,
          totalRequests,
        },
        errorRates: {
          httpErrors: errorRate,
          databaseErrors: dbMetrics.totalQueries > 0 ? (dbMetrics.slowQueries / dbMetrics.totalQueries) * 100 : 0,
          cacheErrors: 0, // Would need to track cache errors
          overall: errorRate,
        },
        resourceUsage: {
          cpu: 0, // Would need system monitoring
          memory: perfMetrics.memoryUsage,
          disk: 0, // Would need disk monitoring
          network: 0, // Would need network monitoring
        },
        queueMetrics: {
          activeQueues: 1, // Simplified
          queuedTasks: queueMetrics.queuedTasks,
          processingRate: queueMetrics.processingRate,
        },
        cacheMetrics: {
          hitRate: cacheStats.overall.hitRate,
          memoryUsage: cacheStats.overall.memoryUsage,
          evictionRate: cacheStats.overall.evictions || 0,
        },
        databaseMetrics: {
          connectionPoolUtilization: 0, // Would need to implement
          slowQueries: dbMetrics.slowQueries,
          activeConnections: 0, // Would need to implement
        },
      };

      this.metrics.push(metrics);

      // Keep only last 1000 metrics to prevent memory issues
      if (this.metrics.length > 1000) {
        this.metrics = this.metrics.slice(-500);
      }

    } catch (error) {
      this.logger.error('Error collecting performance metrics:', error);
    }
  }

  private async checkAlerts(): Promise<void> {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    if (!latestMetrics) return;

    // Check response time alerts
    if (latestMetrics.responseTime.p95 > this.thresholds.responseTime.critical) {
      await this.createAlert('critical', 'response-time', 'p95', latestMetrics.responseTime.p95, this.thresholds.responseTime.critical,
        `Critical response time: ${latestMetrics.responseTime.p95.toFixed(0)}ms (threshold: ${this.thresholds.responseTime.critical}ms)`);
    } else if (latestMetrics.responseTime.p95 > this.thresholds.responseTime.warning) {
      await this.createAlert('warning', 'response-time', 'p95', latestMetrics.responseTime.p95, this.thresholds.responseTime.warning,
        `High response time: ${latestMetrics.responseTime.p95.toFixed(0)}ms (threshold: ${this.thresholds.responseTime.warning}ms)`);
    }

    // Check error rate alerts
    if (latestMetrics.errorRates.overall > this.thresholds.errorRate.critical) {
      await this.createAlert('critical', 'error-rate', 'overall', latestMetrics.errorRates.overall, this.thresholds.errorRate.critical,
        `Critical error rate: ${latestMetrics.errorRates.overall.toFixed(1)}% (threshold: ${this.thresholds.errorRate.critical}%)`);
    } else if (latestMetrics.errorRates.overall > this.thresholds.errorRate.warning) {
      await this.createAlert('warning', 'error-rate', 'overall', latestMetrics.errorRates.overall, this.thresholds.errorRate.warning,
        `High error rate: ${latestMetrics.errorRates.overall.toFixed(1)}% (threshold: ${this.thresholds.errorRate.warning}%)`);
    }

    // Check memory usage alerts
    if (latestMetrics.resourceUsage.memory > this.thresholds.memoryUsage.critical) {
      await this.createAlert('critical', 'memory', 'usage', latestMetrics.resourceUsage.memory, this.thresholds.memoryUsage.critical,
        `Critical memory usage: ${latestMetrics.resourceUsage.memory.toFixed(1)}% (threshold: ${this.thresholds.memoryUsage.critical}%)`);
    } else if (latestMetrics.resourceUsage.memory > this.thresholds.memoryUsage.warning) {
      await this.createAlert('warning', 'memory', 'usage', latestMetrics.resourceUsage.memory, this.thresholds.memoryUsage.warning,
        `High memory usage: ${latestMetrics.resourceUsage.memory.toFixed(1)}% (threshold: ${this.thresholds.memoryUsage.warning}%)`);
    }

    // Check cache hit rate alerts
    if (latestMetrics.cacheMetrics.hitRate < this.thresholds.cacheHitRate.critical) {
      await this.createAlert('critical', 'cache', 'hit-rate', latestMetrics.cacheMetrics.hitRate, this.thresholds.cacheHitRate.critical,
        `Critical cache hit rate: ${latestMetrics.cacheMetrics.hitRate.toFixed(1)}% (threshold: ${this.thresholds.cacheHitRate.critical}%)`);
    } else if (latestMetrics.cacheMetrics.hitRate < this.thresholds.cacheHitRate.warning) {
      await this.createAlert('warning', 'cache', 'hit-rate', latestMetrics.cacheMetrics.hitRate, this.thresholds.cacheHitRate.warning,
        `Low cache hit rate: ${latestMetrics.cacheMetrics.hitRate.toFixed(1)}% (threshold: ${this.thresholds.cacheHitRate.warning}%)`);
    }

    // Check queue length alerts
    if (latestMetrics.queueMetrics.queuedTasks > this.thresholds.queueLength.critical) {
      await this.createAlert('critical', 'queue', 'length', latestMetrics.queueMetrics.queuedTasks, this.thresholds.queueLength.critical,
        `Critical queue length: ${latestMetrics.queueMetrics.queuedTasks} tasks (threshold: ${this.thresholds.queueLength.critical})`);
    } else if (latestMetrics.queueMetrics.queuedTasks > this.thresholds.queueLength.warning) {
      await this.createAlert('warning', 'queue', 'length', latestMetrics.queueMetrics.queuedTasks, this.thresholds.queueLength.warning,
        `High queue length: ${latestMetrics.queueMetrics.queuedTasks} tasks (threshold: ${this.thresholds.queueLength.warning})`);
    }
  }

  private async createAlert(
    type: 'warning' | 'error' | 'critical',
    component: string,
    metric: string,
    value: number,
    threshold: number,
    message: string,
  ): Promise<void> {
    // Check if similar alert already exists and is unresolved
    const existingAlert = this.alerts.find(
      alert => alert.component === component &&
               alert.metric === metric &&
               !alert.resolved &&
               Date.now() - alert.timestamp < 300000 // 5 minutes
    );

    if (existingAlert) {
      // Update existing alert
      existingAlert.value = value;
      existingAlert.timestamp = Date.now();
      return;
    }

    const alert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      component,
      metric,
      value,
      threshold,
      message,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }

    // Log alert
    const logMethod = type === 'critical' ? 'error' : 'warn';
    this.logger[logMethod](`Performance Alert [${type.toUpperCase()}]: ${message}`);
  }

  private async generatePerformanceReport(): Promise<PerformanceReport> {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const periodMetrics = this.metrics.filter(m => m.timestamp >= oneHourAgo);

    if (periodMetrics.length === 0) {
      this.logger.warn('No metrics available for performance report');
      return this.createEmptyReport();
    }

    const totalRequests = periodMetrics.reduce((sum, m) => sum + m.throughput.totalRequests, 0);
    const averageResponseTime = periodMetrics.reduce((sum, m) => sum + m.responseTime.average, 0) / periodMetrics.length;
    const errorRate = periodMetrics.reduce((sum, m) => sum + m.errorRates.overall, 0) / periodMetrics.length;
    const throughput = totalRequests / 3600; // requests per second average

    // Identify bottlenecks
    const bottlenecks = this.identifyBottlenecks(periodMetrics);

    // Generate recommendations
    const recommendations = this.generateRecommendations(bottlenecks, periodMetrics);

    const report: PerformanceReport = {
      period: {
        start: oneHourAgo,
        end: now,
        duration: 3600000,
      },
      summary: {
        averageResponseTime,
        totalRequests,
        errorRate,
        throughput,
      },
      bottlenecks,
      recommendations,
      alerts: this.alerts.filter(alert => alert.timestamp >= oneHourAgo),
    };

    this.logger.log(`Performance report generated: ${totalRequests} requests, ${errorRate.toFixed(1)}% error rate, ${throughput.toFixed(1)} req/s`);

    // Could save report to database or send to monitoring system
    return report;
  }

  private identifyBottlenecks(metrics: SystemMetrics[]): Array<{
    component: string;
    issue: string;
    impact: string;
    recommendation: string;
  }> {
    const bottlenecks = [];

    const avgResponseTime = metrics.reduce((sum, m) => sum + m.responseTime.average, 0) / metrics.length;
    const avgErrorRate = metrics.reduce((sum, m) => sum + m.errorRates.overall, 0) / metrics.length;
    const avgCacheHitRate = metrics.reduce((sum, m) => sum + m.cacheMetrics.hitRate, 0) / metrics.length;
    const avgQueueLength = metrics.reduce((sum, m) => sum + m.queueMetrics.queuedTasks, 0) / metrics.length;

    if (avgResponseTime > 2000) {
      bottlenecks.push({
        component: 'response-time',
        issue: `High average response time: ${avgResponseTime.toFixed(0)}ms`,
        impact: 'Poor user experience and potential timeouts',
        recommendation: 'Optimize database queries, implement caching, or scale application instances',
      });
    }

    if (avgErrorRate > 10) {
      bottlenecks.push({
        component: 'error-rate',
        issue: `High error rate: ${avgErrorRate.toFixed(1)}%`,
        impact: 'Unreliable service and user frustration',
        recommendation: 'Investigate error causes, improve error handling, and add circuit breakers',
      });
    }

    if (avgCacheHitRate < 60) {
      bottlenecks.push({
        component: 'cache',
        issue: `Low cache hit rate: ${avgCacheHitRate.toFixed(1)}%`,
        impact: 'Increased database load and slower responses',
        recommendation: 'Review cache strategy, adjust TTL values, or increase cache size',
      });
    }

    if (avgQueueLength > 500) {
      bottlenecks.push({
        component: 'queue',
        issue: `High queue length: ${avgQueueLength.toFixed(0)} tasks`,
        impact: 'Delayed task processing and potential memory issues',
        recommendation: 'Increase worker count, optimize task processing, or implement load shedding',
      });
    }

    return bottlenecks;
  }

  private generateRecommendations(
    bottlenecks: Array<{component: string; issue: string; impact: string; recommendation: string;}>,
    metrics: SystemMetrics[],
  ): string[] {
    const recommendations = [];

    if (bottlenecks.length === 0) {
      recommendations.push('System performance is within acceptable parameters.');
      return recommendations;
    }

    // General recommendations based on bottlenecks
    if (bottlenecks.some(b => b.component === 'response-time')) {
      recommendations.push('Consider implementing response time optimization techniques.');
    }

    if (bottlenecks.some(b => b.component === 'cache')) {
      recommendations.push('Review and optimize caching strategy for better hit rates.');
    }

    if (bottlenecks.some(b => b.component === 'queue')) {
      recommendations.push('Evaluate async processing capacity and consider scaling workers.');
    }

    // Load-based recommendations
    const avgThroughput = metrics.reduce((sum, m) => sum + m.throughput.requestsPerSecond, 0) / metrics.length;

    if (avgThroughput > 100) {
      recommendations.push('High throughput detected - consider horizontal scaling.');
    }

    return recommendations;
  }

  private createEmptyReport(): PerformanceReport {
    return {
      period: {
        start: Date.now() - 3600000,
        end: Date.now(),
        duration: 3600000,
      },
      summary: {
        averageResponseTime: 0,
        totalRequests: 0,
        errorRate: 0,
        throughput: 0,
      },
      bottlenecks: [],
      recommendations: ['Insufficient data for performance analysis.'],
      alerts: [],
    };
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    return sortedArray[lower] + (sortedArray[upper] - sortedArray[lower]) * (index - lower);
  }

  /**
   * Get current system metrics
   */
  getCurrentMetrics(): SystemMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 10): PerformanceAlert[] {
    return this.alerts
      .filter(alert => !alert.resolved)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      this.logger.log(`Alert resolved: ${alert.message}`);
      return true;
    }
    return false;
  }

  /**
   * Get performance report for a specific time range
   */
  async getPerformanceReport(startTime?: number, endTime?: number): Promise<PerformanceReport> {
    const start = startTime || Date.now() - 3600000; // Default to last hour
    const end = endTime || Date.now();

    const periodMetrics = this.metrics.filter(m => m.timestamp >= start && m.timestamp <= end);

    if (periodMetrics.length === 0) {
      return this.createEmptyReport();
    }

    // Generate report for the specified period
    return this.generatePerformanceReport();
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(): {
    metrics: SystemMetrics[];
    alerts: PerformanceAlert[];
    summary: {
      totalMetrics: number;
      activeAlerts: number;
      averageResponseTime: number;
      averageErrorRate: number;
    };
  } {
    const recentMetrics = this.metrics.slice(-100); // Last 100 metrics
    const activeAlerts = this.alerts.filter(a => !a.resolved);

    const avgResponseTime = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.responseTime.average, 0) / recentMetrics.length
      : 0;

    const avgErrorRate = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.errorRates.overall, 0) / recentMetrics.length
      : 0;

    return {
      metrics: recentMetrics,
      alerts: activeAlerts,
      summary: {
        totalMetrics: this.metrics.length,
        activeAlerts: activeAlerts.length,
        averageResponseTime: avgResponseTime,
        averageErrorRate: avgErrorRate,
      },
    };
  }
}
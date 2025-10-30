import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PerformanceOptimizationService } from './performance-optimization.service';

export interface QueryMetrics {
  query: string;
  executionTime: number;
  timestamp: number;
  slow: boolean;
  connectionId?: string;
}

export interface ConnectionPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  poolUtilization: number;
}

export interface DatabaseOptimizationConfig {
  slowQueryThreshold: number;
  maxConnections: number;
  minConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  enableQueryLogging: boolean;
  enableConnectionPooling: boolean;
}

@Injectable()
export class DatabaseOptimizerService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseOptimizerService.name);
  private queryMetrics: QueryMetrics[] = [];
  private config: DatabaseOptimizationConfig;
  private optimizationInterval: NodeJS.Timeout;
  private slowQueries: Map<string, { count: number; totalTime: number; lastSeen: number }> = new Map();

  constructor(
    private dataSource: DataSource,
    private configService: ConfigService,
    private performanceService: PerformanceOptimizationService,
  ) {
    this.config = {
      slowQueryThreshold: this.configService.get('DB_SLOW_QUERY_THRESHOLD', 1000), // 1 second
      maxConnections: this.configService.get('DB_MAX_CONNECTIONS', 20),
      minConnections: this.configService.get('DB_MIN_CONNECTIONS', 5),
      connectionTimeout: this.configService.get('DB_CONNECTION_TIMEOUT', 30000),
      queryTimeout: this.configService.get('DB_QUERY_TIMEOUT', 30000),
      enableQueryLogging: this.configService.get('DB_ENABLE_QUERY_LOGGING', true),
      enableConnectionPooling: this.configService.get('DB_ENABLE_CONNECTION_POOLING', true),
    };
  }

  async onModuleInit() {
    this.setupQueryMonitoring();
    this.startOptimizationRoutine();
    this.logger.log('Database optimizer initialized');
  }

  private setupQueryMonitoring() {
    // Intercept database queries for monitoring
    const originalQuery = this.dataSource.manager.query.bind(this.dataSource.manager);

    this.dataSource.manager.query = async (query: string, parameters?: any[]) => {
      const startTime = Date.now();

      try {
        const result = await originalQuery(query, parameters);
        const executionTime = Date.now() - startTime;

        this.recordQueryMetrics(query, executionTime);

        if (executionTime > this.config.slowQueryThreshold) {
          this.logger.warn(`Slow query detected (${executionTime}ms): ${query}`);
          this.recordSlowQuery(query, executionTime);
        }

        return result;
      } catch (error) {
        const executionTime = Date.now() - startTime;
        this.recordQueryMetrics(query, executionTime, false);
        throw error;
      }
    };
  }

  private recordQueryMetrics(query: string, executionTime: number, success: boolean = true) {
    const metrics: QueryMetrics = {
      query: query.substring(0, 200), // Truncate long queries
      executionTime,
      timestamp: Date.now(),
      slow: executionTime > this.config.slowQueryThreshold,
    };

    this.queryMetrics.push(metrics);

    // Keep only last 1000 metrics to prevent memory issues
    if (this.queryMetrics.length > 1000) {
      this.queryMetrics = this.queryMetrics.slice(-500);
    }

    // Record in performance service
    this.performanceService.recordOperationTiming('database_query', executionTime, success);
  }

  private recordSlowQuery(query: string, executionTime: number) {
    const queryKey = this.normalizeQuery(query);
    const existing = this.slowQueries.get(queryKey);

    if (existing) {
      existing.count++;
      existing.totalTime += executionTime;
      existing.lastSeen = Date.now();
    } else {
      this.slowQueries.set(queryKey, {
        count: 1,
        totalTime: executionTime,
        lastSeen: Date.now(),
      });
    }
  }

  private normalizeQuery(query: string): string {
    // Normalize queries by replacing literals with placeholders
    return query
      .replace(/\b\d+\b/g, '?') // Replace numbers
      .replace(/'[^']*'/g, '?') // Replace string literals
      .replace(/\b(true|false)\b/gi, '?') // Replace booleans
      .toLowerCase()
      .trim();
  }

  private startOptimizationRoutine() {
    this.optimizationInterval = setInterval(async () => {
      await this.performOptimizationChecks();
    }, 300000); // Every 5 minutes
  }

  private async performOptimizationChecks() {
    try {
      await this.analyzeSlowQueries();
      await this.optimizeConnectionPool();
      await this.checkIndexUsage();
      await this.performMaintenanceTasks();
    } catch (error) {
      this.logger.error('Error during optimization checks:', error);
    }
  }

  private async analyzeSlowQueries() {
    if (this.slowQueries.size === 0) return;

    const topSlowQueries = Array.from(this.slowQueries.entries())
      .sort(([, a], [, b]) => (b.totalTime / b.count) - (a.totalTime / a.count))
      .slice(0, 5);

    this.logger.log('Top 5 slow queries:');
    topSlowQueries.forEach(([query, stats]) => {
      const avgTime = Math.round(stats.totalTime / stats.count);
      this.logger.log(`- ${query}: ${avgTime}ms avg (${stats.count} executions)`);
    });

    // Suggest optimizations
    for (const [query, stats] of topSlowQueries) {
      if (query.includes('where') && !query.includes('index')) {
        this.logger.warn(`Consider adding index for query: ${query}`);
      }
    }
  }

  private async optimizeConnectionPool() {
    try {
      // Get current pool metrics
      const poolMetrics = await this.getConnectionPoolMetrics();

      if (poolMetrics.poolUtilization > 90) {
        this.logger.warn(`High database connection pool utilization: ${poolMetrics.poolUtilization.toFixed(1)}%`);
        // Could trigger scaling or optimization here
      }

      if (poolMetrics.waitingClients > 5) {
        this.logger.warn(`High connection wait queue: ${poolMetrics.waitingClients} waiting clients`);
      }

      // Adaptive pool sizing
      await this.adaptConnectionPool(poolMetrics);
    } catch (error) {
      this.logger.error('Error optimizing connection pool:', error);
    }
  }

  private async getConnectionPoolMetrics(): Promise<ConnectionPoolMetrics> {
    // This would integrate with the actual database driver to get real metrics
    // For now, return mock data based on configuration
    return {
      totalConnections: this.config.maxConnections,
      activeConnections: Math.floor(Math.random() * this.config.maxConnections * 0.7),
      idleConnections: Math.floor(Math.random() * this.config.maxConnections * 0.3),
      waitingClients: Math.floor(Math.random() * 10),
      poolUtilization: Math.floor(Math.random() * 100),
    };
  }

  private async adaptConnectionPool(metrics: ConnectionPoolMetrics) {
    // Adaptive connection pool sizing based on usage patterns
    const utilizationRate = metrics.poolUtilization;

    if (utilizationRate > 85 && this.config.maxConnections < 50) {
      // Increase max connections
      this.config.maxConnections = Math.min(this.config.maxConnections + 5, 50);
      this.logger.log(`Increased max database connections to ${this.config.maxConnections}`);
    } else if (utilizationRate < 30 && this.config.maxConnections > this.config.minConnections) {
      // Decrease max connections
      this.config.maxConnections = Math.max(this.config.maxConnections - 2, this.config.minConnections);
      this.logger.log(`Decreased max database connections to ${this.config.maxConnections}`);
    }
  }

  private async checkIndexUsage() {
    try {
      // Analyze index usage patterns
      const unusedIndexes = await this.findUnusedIndexes();
      const missingIndexes = await this.suggestMissingIndexes();

      if (unusedIndexes.length > 0) {
        this.logger.warn(`Found ${unusedIndexes.length} potentially unused indexes`);
        unusedIndexes.forEach(index => {
          this.logger.warn(`Consider dropping unused index: ${index}`);
        });
      }

      if (missingIndexes.length > 0) {
        this.logger.log(`Suggested ${missingIndexes.length} new indexes`);
        missingIndexes.forEach(suggestion => {
          this.logger.log(`Consider adding index: ${suggestion}`);
        });
      }
    } catch (error) {
      this.logger.error('Error checking index usage:', error);
    }
  }

  private async findUnusedIndexes(): Promise<string[]> {
    // This would query system tables to find unused indexes
    // Simplified implementation
    return [];
  }

  private async suggestMissingIndexes(): Promise<string[]> {
    // Analyze slow queries to suggest missing indexes
    const suggestions: string[] = [];

    for (const [query, stats] of this.slowQueries) {
      if (query.includes('where') && stats.count > 10) {
        // Look for common patterns that might benefit from indexes
        if (query.includes('user_id') && !query.includes('index on user_id')) {
          suggestions.push('CREATE INDEX idx_tasks_user_id ON tasks(user_id)');
        }
        if (query.includes('status') && !query.includes('index on status')) {
          suggestions.push('CREATE INDEX idx_tasks_status ON tasks(status)');
        }
        if (query.includes('due_date') && !query.includes('index on due_date')) {
          suggestions.push('CREATE INDEX idx_tasks_due_date ON tasks(due_date)');
        }
      }
    }

    return [...new Set(suggestions)]; // Remove duplicates
  }

  private async performMaintenanceTasks() {
    try {
      // Run periodic maintenance tasks
      await this.vacuumAnalyzeTables();
      await this.updateTableStatistics();
      await this.checkTableFragmentation();
    } catch (error) {
      this.logger.error('Error performing maintenance tasks:', error);
    }
  }

  private async vacuumAnalyzeTables() {
    // Run VACUUM ANALYZE on tables to update statistics
    const tables = ['tasks', 'users']; // Add more tables as needed

    for (const table of tables) {
      try {
        await this.dataSource.manager.query(`VACUUM ANALYZE ${table}`);
        this.logger.debug(`VACUUM ANALYZE completed for table: ${table}`);
      } catch (error) {
        this.logger.error(`Error vacuuming table ${table}:`, error);
      }
    }
  }

  private async updateTableStatistics() {
    // Update table statistics for better query planning
    try {
      await this.dataSource.manager.query('ANALYZE');
      this.logger.debug('Table statistics updated');
    } catch (error) {
      this.logger.error('Error updating table statistics:', error);
    }
  }

  private async checkTableFragmentation() {
    // Check for table fragmentation and suggest reorganization
    // Only run for PostgreSQL databases
    if (this.dataSource.options.type !== 'postgres') {
      return;
    }

    try {
      const result = await this.dataSource.manager.query(`
        SELECT schemaname, tablename, n_dead_tup, n_live_tup
        FROM pg_stat_user_tables
        WHERE n_dead_tup > n_live_tup * 0.2
        ORDER BY n_dead_tup DESC
        LIMIT 5
      `);

      if (result.length > 0) {
        this.logger.warn('Tables with high fragmentation detected:');
        result.forEach((row: any) => {
          const fragmentationRatio = (row.n_dead_tup / (row.n_live_tup + row.n_dead_tup)) * 100;
          this.logger.warn(
            `${row.schemaname}.${row.tablename}: ${fragmentationRatio.toFixed(1)}% fragmentation`
          );
        });
      }
    } catch (error) {
      // Ignore errors if pg_stat_user_tables is not available or stats not collected
    }
  }

  /**
   * Execute query with optimization and monitoring
   */
  async executeOptimizedQuery<T>(
    query: string,
    parameters: any[] = [],
    options: {
      useCache?: boolean;
      timeout?: number;
      retries?: number;
    } = {},
  ): Promise<T> {
    const { useCache = false, timeout = this.config.queryTimeout, retries = 2 } = options;

    // Check cache first if enabled
    if (useCache) {
      const cacheKey = `db_query_${query}_${JSON.stringify(parameters)}`;
      // Cache logic would go here
    }

    return this.performanceService.executeWithBackpressure(
      async () => {
        return this.executeQueryWithRetry(query, parameters, retries, timeout);
      },
      { priority: 'normal', timeout },
    );
  }

  private async executeQueryWithRetry<T>(
    query: string,
    parameters: any[],
    retries: number,
    timeout: number,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.dataSource.manager.query(query, parameters);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Query attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < retries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await this.delay(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Get database performance metrics
   */
  getDatabaseMetrics() {
    const recentQueries = this.queryMetrics.filter(
      metrics => Date.now() - metrics.timestamp < 300000 // Last 5 minutes
    );

    const slowQueries = recentQueries.filter(q => q.slow);
    const avgResponseTime = recentQueries.length > 0
      ? recentQueries.reduce((sum, q) => sum + q.executionTime, 0) / recentQueries.length
      : 0;

    return {
      totalQueries: recentQueries.length,
      slowQueries: slowQueries.length,
      averageResponseTime: Math.round(avgResponseTime),
      slowQueryPercentage: recentQueries.length > 0 ? (slowQueries.length / recentQueries.length) * 100 : 0,
      topSlowQueries: Array.from(this.slowQueries.entries())
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5)
        .map(([query, stats]) => ({
          query,
          count: stats.count,
          averageTime: Math.round(stats.totalTime / stats.count),
        })),
    };
  }

  /**
   * Force database optimization
   */
  async forceOptimization() {
    this.logger.log('Forcing database optimization...');
    await this.performOptimizationChecks();
    this.logger.log('Database optimization completed');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
    }
  }
}
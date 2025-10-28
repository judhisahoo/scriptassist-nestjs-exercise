import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RateLimitRule {
  name: string;
  maxRequests: number;
  windowMs: number;
  blockDurationMs?: number;
  burstAllowance?: number;
  sliding?: boolean;
}

export interface RateLimitEntry {
  identifier: string;
  requests: number[];
  blockedUntil?: number;
  burstTokens: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
  blockedUntil?: number;
  retryAfter?: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private rules: Map<string, RateLimitRule> = new Map();
  private entries: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private configService: ConfigService) {
    this.initializeDefaultRules();
    this.startCleanupRoutine();
  }

  private initializeDefaultRules() {
    // API rate limiting
    this.addRule({
      name: 'api-standard',
      maxRequests: 100,
      windowMs: 60000, // 1 minute
      blockDurationMs: 300000, // 5 minutes
      burstAllowance: 20,
      sliding: true,
    });

    // Authentication endpoints
    this.addRule({
      name: 'auth-endpoints',
      maxRequests: 5,
      windowMs: 300000, // 5 minutes
      blockDurationMs: 900000, // 15 minutes
      burstAllowance: 1,
      sliding: false,
    });

    // Task creation
    this.addRule({
      name: 'task-creation',
      maxRequests: 50,
      windowMs: 3600000, // 1 hour
      blockDurationMs: 1800000, // 30 minutes
      burstAllowance: 10,
      sliding: true,
    });

    // Search endpoints
    this.addRule({
      name: 'search-endpoints',
      maxRequests: 200,
      windowMs: 60000, // 1 minute
      blockDurationMs: 120000, // 2 minutes
      burstAllowance: 50,
      sliding: true,
    });
  }

  addRule(rule: RateLimitRule) {
    this.rules.set(rule.name, rule);
    this.logger.log(`Rate limit rule added: ${rule.name}`);
  }

  /**
   * Check if request is allowed under rate limiting
   */
  checkLimit(
    identifier: string,
    ruleName: string = 'api-standard',
  ): RateLimitResult {
    const rule = this.rules.get(ruleName);
    if (!rule) {
      this.logger.warn(`Unknown rate limit rule: ${ruleName}`);
      return {
        allowed: true,
        remainingRequests: -1,
        resetTime: Date.now() + 60000,
      };
    }

    const key = `${ruleName}:${identifier}`;
    let entry = this.entries.get(key);

    if (!entry) {
      entry = {
        identifier,
        requests: [],
        burstTokens: rule.burstAllowance || 0,
      };
      this.entries.set(key, entry);
    }

    // Check if currently blocked
    if (entry.blockedUntil && Date.now() < entry.blockedUntil) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: entry.requests.length > 0 ? entry.requests[0] + rule.windowMs : Date.now() + rule.windowMs,
        blockedUntil: entry.blockedUntil,
        retryAfter: Math.ceil((entry.blockedUntil - Date.now()) / 1000),
      };
    }

    const now = Date.now();

    // Clean old requests based on window
    if (rule.sliding) {
      entry.requests = entry.requests.filter(
        timestamp => now - timestamp < rule.windowMs
      );
    } else {
      // Fixed window: clean all requests outside current window
      const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
      entry.requests = entry.requests.filter(
        timestamp => timestamp >= windowStart
      );
    }

    // Check burst allowance first
    if (entry.burstTokens > 0) {
      entry.burstTokens--;
      entry.requests.push(now);

      return {
        allowed: true,
        remainingRequests: rule.maxRequests - entry.requests.length + entry.burstTokens,
        resetTime: rule.sliding
          ? now + rule.windowMs
          : Math.floor((now + rule.windowMs) / rule.windowMs) * rule.windowMs,
      };
    }

    // Check regular rate limit
    if (entry.requests.length < rule.maxRequests) {
      entry.requests.push(now);

      return {
        allowed: true,
        remainingRequests: rule.maxRequests - entry.requests.length,
        resetTime: rule.sliding
          ? now + rule.windowMs
          : Math.floor((now + rule.windowMs) / rule.windowMs) * rule.windowMs,
      };
    }

    // Rate limit exceeded - apply block
    entry.blockedUntil = now + (rule.blockDurationMs || rule.windowMs);

    this.logger.warn(
      `Rate limit exceeded for ${identifier} on rule ${ruleName}. ` +
      `Requests: ${entry.requests.length}, Limit: ${rule.maxRequests}, ` +
      `Blocked until: ${new Date(entry.blockedUntil).toISOString()}`
    );

    return {
      allowed: false,
      remainingRequests: 0,
      resetTime: rule.sliding
        ? now + rule.windowMs
        : Math.floor((now + rule.windowMs) / rule.windowMs) * rule.windowMs,
      blockedUntil: entry.blockedUntil,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  /**
   * Get rate limit status for an identifier
   */
  getLimitStatus(identifier: string, ruleName: string = 'api-standard') {
    const rule = this.rules.get(ruleName);
    if (!rule) {
      return null;
    }

    const key = `${ruleName}:${identifier}`;
    const entry = this.entries.get(key);

    if (!entry) {
      return {
        requestsInWindow: 0,
        remainingRequests: rule.maxRequests,
        windowMs: rule.windowMs,
        blocked: false,
      };
    }

    const now = Date.now();
    const requestsInWindow = rule.sliding
      ? entry.requests.filter(timestamp => now - timestamp < rule.windowMs).length
      : entry.requests.length;

    const blocked = entry.blockedUntil && now < entry.blockedUntil;

    return {
      requestsInWindow,
      remainingRequests: blocked ? 0 : Math.max(0, rule.maxRequests - requestsInWindow),
      windowMs: rule.windowMs,
      blocked,
      blockedUntil: entry.blockedUntil,
      burstTokensRemaining: entry.burstTokens,
    };
  }

  /**
   * Reset rate limit for an identifier
   */
  resetLimit(identifier: string, ruleName?: string) {
    if (ruleName) {
      const key = `${ruleName}:${identifier}`;
      this.entries.delete(key);
      this.logger.debug(`Reset rate limit for ${identifier} on rule ${ruleName}`);
    } else {
      // Reset all rules for this identifier
      for (const rule of this.rules.keys()) {
        const key = `${rule}:${identifier}`;
        this.entries.delete(key);
      }
      this.logger.debug(`Reset all rate limits for ${identifier}`);
    }
  }

  /**
   * Update rate limit rule dynamically
   */
  updateRule(ruleName: string, updates: Partial<RateLimitRule>) {
    const existingRule = this.rules.get(ruleName);
    if (!existingRule) {
      throw new Error(`Rate limit rule ${ruleName} not found`);
    }

    const updatedRule = { ...existingRule, ...updates };
    this.rules.set(ruleName, updatedRule);
    this.logger.log(`Updated rate limit rule: ${ruleName}`);
  }

  /**
   * Get rate limiting statistics
   */
  getStatistics() {
    const now = Date.now();
    const ruleStats: Record<string, any> = {};

    for (const [ruleName, rule] of this.rules) {
      const ruleEntries = Array.from(this.entries.entries())
        .filter(([key]) => key.startsWith(`${ruleName}:`))
        .map(([, entry]) => entry);

      const totalRequests = ruleEntries.reduce((sum, entry) => sum + entry.requests.length, 0);
      const blockedEntries = ruleEntries.filter(entry => entry.blockedUntil && now < entry.blockedUntil).length;
      const activeEntries = ruleEntries.length;

      ruleStats[ruleName] = {
        rule: { ...rule },
        activeEntries,
        blockedEntries,
        totalRequests,
        averageRequestsPerEntry: activeEntries > 0 ? totalRequests / activeEntries : 0,
      };
    }

    return {
      totalRules: this.rules.size,
      totalActiveEntries: this.entries.size,
      rules: ruleStats,
    };
  }

  /**
   * Adaptive rate limiting based on system load
   */
  async adaptiveRateLimiting() {
    // This would integrate with performance monitoring
    // For now, implement basic adaptive logic

    const stats = this.getStatistics();

    // If many entries are being blocked, system might be under attack
    let totalBlocked = 0;
    let totalActive = 0;

    for (const ruleStat of Object.values(stats.rules) as any[]) {
      totalBlocked += ruleStat.blockedEntries;
      totalActive += ruleStat.activeEntries;
    }

    const blockRate = totalActive > 0 ? (totalBlocked / totalActive) * 100 : 0;

    if (blockRate > 20) {
      // High block rate - tighten rate limits
      this.logger.warn(`High block rate detected: ${blockRate.toFixed(1)}%. Tightening rate limits.`);

      for (const [ruleName, rule] of this.rules) {
        if (rule.name !== 'auth-endpoints') { // Don't tighten auth limits
          this.updateRule(ruleName, {
            maxRequests: Math.max(Math.floor(rule.maxRequests * 0.8), 1),
          });
        }
      }
    } else if (blockRate < 5) {
      // Low block rate - relax rate limits slightly
      for (const [ruleName, rule] of this.rules) {
        if (rule.name !== 'auth-endpoints') {
          this.updateRule(ruleName, {
            maxRequests: Math.min(Math.floor(rule.maxRequests * 1.1), rule.maxRequests * 2),
          });
        }
      }
    }
  }

  /**
   * Create custom rate limit rule
   */
  createCustomRule(
    name: string,
    maxRequests: number,
    windowMs: number,
    options: {
      blockDurationMs?: number;
      burstAllowance?: number;
      sliding?: boolean;
    } = {},
  ) {
    const rule: RateLimitRule = {
      name,
      maxRequests,
      windowMs,
      blockDurationMs: options.blockDurationMs || windowMs,
      burstAllowance: options.burstAllowance || Math.floor(maxRequests * 0.2),
      sliding: options.sliding || true,
    };

    this.addRule(rule);
    return rule;
  }

  /**
   * Middleware helper for Express/NestJS
   */
  createMiddleware(ruleName: string = 'api-standard') {
    return (req: any, res: any, next: () => void) => {
      const identifier = req.ip || req.connection.remoteAddress || 'unknown';
      const result = this.checkLimit(identifier, ruleName);

      if (!result.allowed) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
          resetTime: new Date(result.resetTime).toISOString(),
        });
        return;
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': this.rules.get(ruleName)?.maxRequests || 100,
        'X-RateLimit-Remaining': result.remainingRequests,
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
      });

      next();
    };
  }

  private startCleanupRoutine() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 300000); // Clean every 5 minutes
  }

  private cleanupExpiredEntries() {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.entries) {
      // Remove entries that haven't been active in the longest window
      const maxWindow = Math.max(...Array.from(this.rules.values()).map(r => r.windowMs));
      const oldestAllowed = now - maxWindow * 2; // Keep entries for 2x the longest window

      const hasRecentActivity = entry.requests.some(timestamp => timestamp > oldestAllowed);
      const isBlocked = entry.blockedUntil && entry.blockedUntil > now;

      if (!hasRecentActivity && !isBlocked) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.entries.delete(key);
    });

    if (keysToDelete.length > 0) {
      this.logger.debug(`Cleaned up ${keysToDelete.length} expired rate limit entries`);
    }
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
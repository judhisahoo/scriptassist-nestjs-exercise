import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * Global logging interceptor for HTTP requests and responses
 * Provides comprehensive request/response logging with correlation IDs
 * Includes performance monitoring, error tracking, and security sanitization
 *
 * Features:
 * - Request correlation IDs for tracing
 * - Performance monitoring with slow request warnings
 * - Comprehensive error logging with context
 * - Security-conscious data sanitization
 * - Response size tracking
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  /**
   * Intercepts HTTP requests to add logging and monitoring
   * @param context - Execution context containing request details
   * @param next - Call handler for continuing the request pipeline
   * @returns Observable stream with logging applied
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Extract request information
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const userId = (request as any).user?.id || 'anonymous';
    const correlationId = headers['x-correlation-id'] || this.generateCorrelationId();

    // Add correlation ID to response for client-side tracing
    response.setHeader('x-correlation-id', correlationId);

    // Log incoming request details
    this.logger.log(
      `[${correlationId}] ${method} ${url} - User: ${userId} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}...`,
    );

    return next.handle().pipe(
      tap(data => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log successful response with performance metrics
        this.logger.log(
          `[${correlationId}] ${method} ${url} - ${statusCode} - ${duration}ms - Response size: ${this.getResponseSize(data)}`,
        );

        // Performance monitoring - warn on slow requests
        if (duration > 1000) {
          this.logger.warn(`[${correlationId}] Slow request: ${method} ${url} took ${duration}ms`);
        }
      }),
      catchError(error => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        // Comprehensive error logging with full context
        this.logger.error(
          `[${correlationId}] ${method} ${url} - ${statusCode} - ${duration}ms - Error: ${error.message}`,
          {
            error: error.stack,
            body: this.sanitizeRequestBody(request.body),
            query: request.query,
            params: request.params,
            userId,
            ip,
          },
        );

        throw error; // Re-throw to allow error handling by filters
      }),
    );
  }

  /**
   * Generates a unique correlation ID for request tracing
   * Format: req_{timestamp}_{random_suffix}
   * @returns Unique correlation identifier string
   */
  private generateCorrelationId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculates human-readable response size
   * @param data - Response data to measure
   * @returns Formatted size string (B, KB, MB)
   */
  private getResponseSize(data: any): string {
    try {
      const size = JSON.stringify(data).length;
      if (size < 1024) return `${size}B`;
      if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
      return `${Math.round(size / (1024 * 1024))}MB`;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Sanitizes request body by removing sensitive information
   * Prevents logging of passwords, tokens, and other confidential data
   * @param body - Original request body
   * @returns Sanitized copy of the request body
   */
  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };

    // List of sensitive fields to redact
    const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'creditCard'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}

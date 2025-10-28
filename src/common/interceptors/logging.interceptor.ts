import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const userId = (request as any).user?.id || 'anonymous';
    const correlationId = headers['x-correlation-id'] || this.generateCorrelationId();

    // Add correlation ID to response headers
    response.setHeader('x-correlation-id', correlationId);

    // Log incoming request
    this.logger.log(
      `[${correlationId}] ${method} ${url} - User: ${userId} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}...`,
    );

    return next.handle().pipe(
      tap(data => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log successful response
        this.logger.log(
          `[${correlationId}] ${method} ${url} - ${statusCode} - ${duration}ms - Response size: ${this.getResponseSize(data)}`,
        );

        // Log performance warnings
        if (duration > 1000) {
          this.logger.warn(`[${correlationId}] Slow request: ${method} ${url} took ${duration}ms`);
        }
      }),
      catchError(error => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        // Log error with full context
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

        throw error;
      }),
    );
  }

  private generateCorrelationId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

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

  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'creditCard'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}

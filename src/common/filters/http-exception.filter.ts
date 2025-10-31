import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * Global HTTP exception filter for standardized error responses
 * Catches all HttpException instances and formats them consistently
 * Provides different logging levels for development vs production
 * Sanitizes error messages to prevent information leakage
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private configService: ConfigService) {}

  /**
   * Catches and processes HTTP exceptions
   * @param exception - The HttpException that was thrown
   * @param host - ArgumentsHost for accessing request/response context
   */
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    // Log error with stack trace in development, minimal logging in production
    if (isDevelopment) {
      this.logger.error(
        `HTTP Exception: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`HTTP Exception: ${exception.message}`);
    }

    // Extract and sanitize error message
    let message = exception.message;
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      // Handle structured error responses (e.g., from ValidationPipe)
      message =
        ((exceptionResponse as Record<string, unknown>).message as string) || exception.message;
    }

    // Security: Prevent exposure of sensitive information in error messages
    if (message.includes('password') || message.includes('token') || message.includes('secret')) {
      message = 'An error occurred';
    }

    // Return standardized error response
    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

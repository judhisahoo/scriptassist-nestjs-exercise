import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private configService: ConfigService) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    // Log error with stack in development, without in production
    if (isDevelopment) {
      this.logger.error(
        `HTTP Exception: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`HTTP Exception: ${exception.message}`);
    }

    // Sanitize error message to avoid exposing sensitive info
    let message = exception.message;
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message =
        ((exceptionResponse as Record<string, unknown>).message as string) || exception.message;
    }

    // Avoid exposing internal details
    if (message.includes('password') || message.includes('token') || message.includes('secret')) {
      message = 'An error occurred';
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

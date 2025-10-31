import { registerAs } from '@nestjs/config';

/**
 * BullMQ (Redis-based queue) configuration using NestJS Config module
 *
 * This configuration provides connection settings for Redis, which is used
 * by BullMQ for asynchronous job processing and queue management. It supports
 * both local development (default Redis instance) and production deployments
 * with external Redis services.
 *
 * Configuration includes:
 * - Redis host configuration (localhost for development)
 * - Redis port configuration (standard 6379)
 * - Connection settings for BullMQ queues
 *
 * @remarks
 * - Used by BullModule.forRootAsync() in app.module.ts
 * - Supports environment-specific Redis configurations
 * - Port is parsed as integer for proper Redis connection
 * - Enables scalable background job processing
 */
export default registerAs('bull', () => ({
  /** Redis connection configuration for BullMQ */
  connection: {
    /** Redis server hostname - defaults to localhost for development */
    host: process.env.REDIS_HOST || 'localhost',

    /** Redis server port - defaults to standard Redis port 6379 */
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
}));

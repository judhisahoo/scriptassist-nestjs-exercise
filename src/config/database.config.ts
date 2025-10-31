import { registerAs } from '@nestjs/config';

/**
 * PostgreSQL database configuration using NestJS Config module
 *
 * This configuration provides connection settings for the PostgreSQL database
 * used by TypeORM. It supports different environments with appropriate settings
 * for development (schema synchronization, query logging) and production
 * (performance optimizations, security considerations).
 *
 * Configuration includes:
 * - Database connection parameters (host, port, credentials)
 * - Database name and schema settings
 * - Development vs production behavior (synchronization, logging)
 * - TypeORM-specific options for optimal performance
 *
 * @remarks
 * - Used by TypeOrmModule.forRootAsync() in app.module.ts
 * - Environment-specific behavior for development vs production
 * - Secure credential handling through environment variables
 * - Schema synchronization only enabled in development
 */
export default registerAs('database', () => ({
  /** PostgreSQL server hostname - defaults to localhost */
  host: process.env.DB_HOST || 'localhost',

  /** PostgreSQL server port - defaults to standard PostgreSQL port 5432 */
  port: parseInt(process.env.DB_PORT || '5432', 10),

  /** Database username for authentication */
  username: process.env.DB_USERNAME || 'postgres',

  /** Database password for authentication */
  password: process.env.DB_PASSWORD || 'postgres',

  /** Target database name within PostgreSQL instance */
  database: process.env.DB_DATABASE || 'taskflow',

  /**
   * Schema synchronization flag
   * Only enabled in development - automatically creates/updates database schema
   * Disabled in production for safety and performance
   */
  synchronize: process.env.NODE_ENV === 'development',

  /**
   * Query logging flag
   * Only enabled in development - logs all SQL queries for debugging
   * Disabled in production to reduce overhead and prevent log pollution
   */
  logging: process.env.NODE_ENV === 'development',
}));

import { registerAs } from '@nestjs/config';

/**
 * Application-level configuration using NestJS Config module
 *
 * This configuration provides global application settings that are
 * used across different modules and services. It centralizes environment
 * variable handling and provides sensible defaults for development.
 *
 * Configuration includes:
 * - Server port configuration
 * - Environment detection (development/production/staging)
 * - Application-wide settings
 *
 * @remarks
 * - Uses registerAs() to create a namespaced configuration object
 * - Environment variables take precedence over defaults
 * - Port is parsed as integer for proper type safety
 * - NODE_ENV is used for environment-specific behavior
 */
export default registerAs('app', () => ({
  /** Server port for HTTP listener - defaults to 3000 */
  port: parseInt(process.env.PORT || '3000', 10),

  /** Application environment - used for conditional logic throughout the app */
  environment: process.env.NODE_ENV || 'development',
}));

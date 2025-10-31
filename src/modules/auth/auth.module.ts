import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

/**
 * Authentication module configuring JWT authentication, Passport strategies, and user management.
 * Provides complete authentication infrastructure for the application.
 *
 * @remarks
 * This module configures:
 * - JWT token generation and validation
 * - Passport JWT strategy for request authentication
 * - User service integration for authentication operations
 * - Configuration-based JWT secret and options
 *
 * @example
 * ```typescript
 * // Module is automatically imported in AppModule
 * // JWT configuration is loaded from environment variables
 * ```
 */
@Module({
  imports: [
    /** User management module for authentication operations */
    UsersModule,

    /** Passport module configured with JWT as default strategy */
    PassportModule.register({ defaultStrategy: 'jwt' }),

    /** JWT module with async configuration for token management */
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
      }),
    }),
  ],

  /** Controllers providing authentication endpoints */
  controllers: [AuthController],

  /** Services and strategies for authentication logic */
  providers: [AuthService, JwtStrategy],

  /** Exported services for use in other modules */
  exports: [AuthService],
})
export class AuthModule {}

# Security Enhancement Report

## Overview
This report outlines the security vulnerabilities identified in the NestJS application and proposes enhancements to address them. The focus is on strengthening authentication, authorization, rate limiting, and data handling to improve overall security posture.

## Identified Vulnerabilities
1. **Inadequate Authentication Mechanism**: The current authentication system lacks robust features such as refresh token rotation, making it susceptible to token theft and replay attacks.
2. **Improper Authorization Checks**: Authorization is not enforced at multiple levels, allowing potential bypasses in API endpoints.
3. **Unprotected Sensitive Data Exposure**: Error responses may leak sensitive information, such as stack traces or internal data, which could be exploited.
4. **Insecure Rate Limiting Implementation**: The existing rate limiting is not secure or comprehensive, potentially allowing abuse like brute-force attacks.

## Proposed Enhancements
1. **Strengthen Authentication with Refresh Token Rotation**: Implement secure token management to invalidate old tokens and rotate refresh tokens.
2. **Implement Proper Authorization Checks at Multiple Levels**: Add guards, decorators, and middleware to enforce permissions across controllers and services.
3. **Create a Secure Rate Limiting System**: Develop a robust rate limiting mechanism using libraries like `express-rate-limit` or custom implementations.
4. **Add Data Validation and Sanitization**: Ensure all inputs are validated and sanitized to prevent injection attacks and data corruption.

## Detailed Code Changes
Below are the specific code modifications required for each enhancement. Changes are described with references to relevant files in the project structure.

### 1. Strengthen Authentication with Refresh Token Rotation
- **File: src/modules/auth/auth.service.ts**
  - Update the login method to generate both access and refresh tokens.
  - Implement token rotation logic: When a refresh token is used, generate a new refresh token and invalidate the old one.
  - Add a method to blacklist or store invalidated tokens (e.g., using Redis or database).
  - Example Change:
    ```
    // In login method
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.generateRefreshToken(payload);
    // Store refreshToken in database or cache for validation
    return { accessToken, refreshToken };

    // New method: generateRefreshToken
    private generateRefreshToken(payload: any): string {
      // Generate a unique refresh token and store it
      const token = this.jwtService.sign(payload, { expiresIn: '7d' });
      // Save to database or cache
      return token;
    }

    // In refresh method
    async refreshToken(refreshToken: string): Promise<any> {
      // Validate refreshToken
      // If valid, generate new access and refresh tokens
      // Invalidate old refreshToken
    }
    ```

- **File: src/modules/auth/auth.controller.ts**
  - Add a refresh endpoint to handle token rotation.
  - Example Change:
    ```
    @Post('refresh')
    async refresh(@Body() refreshDto: RefreshDto) {
      return this.authService.refreshToken(refreshDto.refreshToken);
    }
    ```

- **File: src/config/jwt.config.ts**
  - Ensure JWT configuration supports refresh tokens with appropriate expiration times.

### 2. Implement Proper Authorization Checks at Multiple Levels
- **File: src/common/guards/roles.guard.ts**
  - Enhance the guard to check roles more strictly and integrate with multiple levels (e.g., per method).
  - Example Change:
    ```
    @Injectable()
    export class RolesGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
          context.getHandler(),
          context.getClass(),
        ]);
        // Check if user has required roles
        return requiredRoles.some((role) => user.roles?.includes(role));
      }
    }
    ```

- **File: src/modules/auth/decorators/roles.decorator.ts**
  - Ensure the decorator is applied to controllers and methods as needed.
  - Example Usage:
    ```
    @UseGuards(RolesGuard)
    @Roles('admin')
    @Get('admin-only')
    getAdminData() {
      // Implementation
    }
    ```

- **File: src/modules/tasks/tasks.controller.ts** (and similar for other modules)
  - Apply authorization guards to sensitive endpoints.
  - Example Change:
    ```
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('user')
    @Post()
    createTask(@Body() createTaskDto: CreateTaskDto) {
      // Implementation
    }
    ```

### 3. Create a Secure Rate Limiting System
- **File: src/common/guards/rate-limit.guard.ts**
  - Implement or enhance rate limiting using a library like `@nestjs/throttler`.
  - Example Change:
    ```
    import { ThrottlerGuard } from '@nestjs/throttler';

    @Injectable()
    export class CustomRateLimitGuard extends ThrottlerGuard {
      protected getTracker(req: Record<string, any>): string {
        return req.ip; // Or use user ID for authenticated requests
      }
    }
    ```

- **File: src/app.module.ts**
  - Configure the ThrottlerModule globally.
  - Example Change:
    ```
    import { ThrottlerModule } from '@nestjs/throttler';

    @Module({
      imports: [
        ThrottlerModule.forRoot({
          ttl: 60, // Time to live in seconds
          limit: 10, // Number of requests per TTL
        }),
        // Other modules
      ],
    })
    export class AppModule {}
    ```

- **File: src/common/decorators/rate-limit.decorator.ts**
  - Create a decorator for per-endpoint rate limiting.
  - Example Change:
    ```
    import { SetMetadata } from '@nestjs/common';

    export const RateLimit = (limit: number, ttl: number) =>
      SetMetadata('rateLimit', { limit, ttl });
    ```

### 4. Add Data Validation and Sanitization
- **File: src/common/pipes/validation.pipe.ts**
  - Enhance the global validation pipe to handle sanitization.
  - Example Change:
    ```
    import { ValidationPipe } from '@nestjs/common';
    import * as sanitizeHtml from 'sanitize-html';

    @Injectable()
    export class CustomValidationPipe extends ValidationPipe {
      transform(value: any, metadata: ArgumentMetadata) {
        if (typeof value === 'string') {
          value = sanitizeHtml(value); // Sanitize HTML
        }
        return super.transform(value, metadata);
      }
    }
    ```

- **File: src/main.ts**
  - Apply the custom validation pipe globally.
  - Example Change:
    ```
    app.useGlobalPipes(new CustomValidationPipe());
    ```

- **File: src/modules/auth/dto/login.dto.ts** (and other DTOs)
  - Add validation decorators.
  - Example Change:
    ```
    import { IsEmail, IsNotEmpty } from 'class-validator';

    export class LoginDto {
      @IsEmail()
      @IsNotEmpty()
      email: string;

      @IsNotEmpty()
      password: string;
    }
    ```

## Implementation Plan
1. **Review and Backup**: Review current code and create backups.
2. **Implement Authentication Enhancements**: Update auth service and controller.
3. **Enhance Authorization**: Apply guards and decorators to all relevant endpoints.
4. **Set Up Rate Limiting**: Install necessary packages and configure globally.
5. **Add Validation**: Update pipes and DTOs for sanitization.
6. **Testing**: Write unit and integration tests for new features.
7. **Deployment**: Deploy changes and monitor for issues.

## Conclusion
Implementing these changes will significantly improve the security of the application. Regular security audits and updates are recommended to maintain protection against evolving threats.
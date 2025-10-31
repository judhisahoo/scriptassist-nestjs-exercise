import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * Data Transfer Object for user update requests.
 * Extends CreateUserDto with partial type to allow optional fields.
 *
 * @remarks
 * This DTO allows partial updates to user accounts:
 * - Email can be updated (uniqueness validation required)
 * - Name can be updated with validation
 * - Password can be updated (will be re-hashed)
 * - All fields are optional for partial updates
 *
 * @example
 * ```typescript
 * // Update only email
 * { email: 'newemail@example.com' }
 *
 * // Update name and password
 * { name: 'New Name', password: 'NewPassword123!' }
 * ```
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}

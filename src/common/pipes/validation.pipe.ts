import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * Global validation pipe for automatic request payload validation
 * Uses class-validator and class-transformer to validate incoming data
 * Transforms plain objects to class instances and validates constraints
 *
 * Applied globally to ensure all incoming data meets validation rules
 * Throws BadRequestException with detailed error messages on validation failure
 */
@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  /**
   * Transforms and validates input data
   * @param value - The input value to validate
   * @param metadata - Argument metadata containing type information
   * @returns Validated and transformed object
   * @throws BadRequestException if validation fails
   */
  async transform(value: any, { metatype }: ArgumentMetadata) {
    // Skip validation for primitive types and when no metatype is provided
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    // Transform plain object to class instance
    const object = plainToInstance(metatype, value);

    // Validate the transformed object
    const errors = await validate(object);

    if (errors.length > 0) {
      // Extract validation error messages
      const messages = errors.map(error => {
        const constraints = error.constraints || {};
        return Object.values(constraints).join(', ');
      });

      // Throw structured validation error
      throw new BadRequestException({
        message: 'Validation failed',
        errors: messages,
      });
    }

    return object;
  }

  /**
   * Determines if the metatype should be validated
   * Skips validation for built-in types that don't need class-validator
   * @param metatype - The type to check
   * @returns true if validation should be performed, false otherwise
   */
  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}

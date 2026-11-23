import type { ZodError } from 'zod';

export interface ErrorDetail {
  field: string;
  message: string;
}

/**
 * Base class for every error we expect and know how to describe to a client.
 * Anything that is *not* an AppError is treated as a bug: logged with a stack and returned as a
 * generic 500 so internals never leak.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }

  static fromZod(error: ZodError, message = 'Request validation failed'): ValidationError {
    return new ValidationError(message, formatZodIssues(error));
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(409, code, message);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, code = 'UNPROCESSABLE') {
    super(422, code, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

export function formatZodIssues(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => {
    const field = issue.path.length ? issue.path.join('.') : '(body)';
    if (issue.code === 'unrecognized_keys') {
      return { field, message: `Unknown field(s): ${issue.keys.join(', ')}` };
    }
    return { field, message: issue.message };
  });
}

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: FieldError[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors?: FieldError[]) {
    super(400, 'BAD_REQUEST', message, errors);
  }
}
export class ValidationError extends AppError {
  constructor(errors: FieldError[], message = 'Validation failed') {
    super(400, 'VALIDATION_ERROR', message, errors);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(409, code, message);
  }
}
export class InvalidTransitionError extends AppError {
  constructor(message: string) {
    super(409, 'INVALID_STATE_TRANSITION', message);
  }
}
export class PayloadTooLargeError extends AppError {
  constructor(message = 'Uploaded file is too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}
export class UnprocessableError extends AppError {
  constructor(message: string, code = 'UNPROCESSABLE', errors?: FieldError[]) {
    super(422, code, message, errors);
  }
}
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(429, 'RATE_LIMITED', message);
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, message);
  }
}

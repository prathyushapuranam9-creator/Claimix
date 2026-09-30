/** Errors safe to surface to users. Anything else is treated as an internal error. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") {
    super(message, "FORBIDDEN", 403);
  }
}

/** Also used for records outside the caller's scope, so existence is never leaked. */
export class NotFoundError extends AppError {
  constructor(message = "The requested record was not found.") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Some fields are invalid.",
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, "VALIDATION", 422);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Please try again later.") {
    super(message, "RATE_LIMITED", 429);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message: string) {
    super(message, "INVALID_TRANSITION", 409);
  }
}

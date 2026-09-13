/**
 * Application error hierarchy. Services throw these; the API layer maps them to
 * HTTP responses and MCP tools map them to tool errors. Anything that is not an
 * AppError is treated as an unexpected 500 and its message is never leaked.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INSUFFICIENT_CREDITS"
  | "STORAGE_BUDGET_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "NOT_IMPLEMENTED"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INSUFFICIENT_CREDITS: 402,
  STORAGE_BUDGET_EXCEEDED: 507,
  UPSTREAM_ERROR: 502,
  NOT_IMPLEMENTED: 501,
  CONFIG_ERROR: 500,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
  /** Whether a retry of the same operation may succeed (used by the job runner). */
  retryable?: boolean;
  /** Whether the message is safe to show to API consumers. Defaults to true for 4xx. */
  expose?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.expose = options.expose ?? this.status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", id ? `${resource} not found: ${id}` : `${resource} not found`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super("CONFIG_ERROR", message, { expose: false });
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super("NOT_IMPLEMENTED", `${feature} is not implemented yet`, { expose: true });
  }
}

export class UpstreamError extends AppError {
  constructor(service: string, message: string, options: AppErrorOptions = {}) {
    super("UPSTREAM_ERROR", `${service}: ${message}`, { expose: true, ...options });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalize any thrown value into an AppError without leaking internals. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred", { cause: error, expose: false });
}

/** Serialize an unknown error for structured logs. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(isAppError(error) ? { code: error.code, status: error.status, details: error.details } : {}),
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { value: String(error) };
}

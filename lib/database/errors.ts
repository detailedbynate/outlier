import { AppError } from "@/lib/core/errors";

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Map a Supabase/PostgREST error to an AppError with a sensible HTTP code. */
export function toDatabaseError(error: PostgrestLikeError, operation: string): AppError {
  const details = { operation, pgCode: error.code, hint: error.hint ?? undefined };
  switch (error.code) {
    case "23505":
      return new AppError("CONFLICT", `Duplicate record (${operation})`, { details, cause: error });
    case "23503":
      return new AppError("BAD_REQUEST", `Referenced record does not exist (${operation})`, { details, cause: error });
    case "23514":
    case "22P02":
      return new AppError("VALIDATION_ERROR", `Invalid data (${operation})`, { details, cause: error });
    case "PGRST116":
      return new AppError("NOT_FOUND", `Record not found (${operation})`, { details, cause: error });
    default:
      return new AppError("INTERNAL_ERROR", `Database error during ${operation}`, {
        details,
        cause: error,
        expose: false,
        // Connection-level failures are worth retrying from jobs.
        retryable: !error.code || error.code.startsWith("08"),
      });
  }
}

interface SupabaseResult<T> {
  data: T | null;
  error: PostgrestLikeError | null;
}

/** Throw a mapped AppError if the query failed. For writes that return no rows. */
export function assertOk(result: { error: PostgrestLikeError | null }, operation: string): void {
  if (result.error) throw toDatabaseError(result.error, operation);
}

/** Unwrap a query that must return data (lists, `.single()`). */
export function unwrap<T>(result: SupabaseResult<T>, operation: string): T {
  assertOk(result, operation);
  if (result.data === null) {
    throw new AppError("INTERNAL_ERROR", `No data returned from ${operation}`, { expose: false });
  }
  return result.data;
}

/** Unwrap a query where "no row" is a valid outcome (`.maybeSingle()`). */
export function unwrapMaybe<T>(result: SupabaseResult<T>, operation: string): T | null {
  assertOk(result, operation);
  return result.data;
}

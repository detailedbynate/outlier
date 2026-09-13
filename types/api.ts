import type { ErrorCode } from "@/lib/core/errors";

/** Public API response envelope (API v1). Stable contract for external consumers. */

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  requestId?: string;
  nextPageToken?: string | null;
  prevPageToken?: string | null;
  totalResults?: number | null;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

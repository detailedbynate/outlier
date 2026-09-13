import { ValidationError } from "@/lib/core/errors";

/**
 * Object storage abstraction for generated media (thumbnails, images, audio,
 * video renders, exports). Supabase Storage today; S3/R2 can implement the same interface.
 */

export interface StoredObject {
  path: string;
  contentType: string;
  sizeBytes: number;
}

export interface PutObjectOptions {
  contentType: string;
  /** Overwrite an existing object at the same path. */
  upsert?: boolean;
  cacheControlSeconds?: number;
}

export interface StorageProvider {
  readonly name: string;
  put(path: string, body: Blob | ArrayBuffer | Uint8Array, options: PutObjectOptions): Promise<StoredObject>;
  getSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  delete(paths: string[]): Promise<void>;
}

/**
 * Build a namespaced object key: workspaces/{workspaceId}/{category}/{name}.
 * Keeps tenant data separable for storage policies and cleanup.
 */
export function workspaceObjectPath(workspaceId: string, category: string, fileName: string): string {
  const safe = (segment: string, label: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..") {
      throw new ValidationError(`Invalid storage path ${label}: ${segment}`);
    }
    return segment;
  };
  return `workspaces/${safe(workspaceId, "workspaceId")}/${safe(category, "category")}/${safe(fileName, "fileName")}`;
}

import { UpstreamError } from "@/lib/core/errors";
import type { DatabaseClient } from "@/lib/database/client";
import type { PutObjectOptions, StorageProvider, StoredObject } from "./types";

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";

  constructor(
    private readonly client: DatabaseClient,
    private readonly bucket: string,
  ) {}

  async put(path: string, body: Blob | ArrayBuffer | Uint8Array, options: PutObjectOptions): Promise<StoredObject> {
    const { error } = await this.client.storage.from(this.bucket).upload(path, body, {
      contentType: options.contentType,
      upsert: options.upsert ?? false,
      cacheControl: String(options.cacheControlSeconds ?? 3600),
    });
    if (error) throw new UpstreamError("Supabase Storage", `upload failed: ${error.message}`, { cause: error, retryable: true });
    const sizeBytes = body instanceof Blob ? body.size : body.byteLength;
    return { path, contentType: options.contentType, sizeBytes };
  }

  async getSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new UpstreamError("Supabase Storage", `signing failed: ${error?.message ?? "no url"}`, { cause: error });
    return data.signedUrl;
  }

  async delete(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(paths);
    if (error) throw new UpstreamError("Supabase Storage", `delete failed: ${error.message}`, { cause: error });
  }
}

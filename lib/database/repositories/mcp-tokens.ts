import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { McpTokenRow } from "@/types/database";

/** Personal MCP tokens (supabase/migrations/20261019000041_mcp_tokens.sql). Only hashes are stored. */
export class McpTokenRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(row: { userId: string; tokenHash: string; prefix: string; label: string; staff: boolean }): Promise<McpTokenRow> {
    return unwrap(
      await this.db
        .from("mcp_tokens")
        .insert({ user_id: row.userId, token_hash: row.tokenHash, prefix: row.prefix, label: row.label, staff: row.staff })
        .select("*")
        .single(),
      "mcpTokens.create",
    );
  }

  async findActiveByHash(tokenHash: string): Promise<McpTokenRow | null> {
    return unwrapMaybe(await this.db.from("mcp_tokens").select("*").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle(), "mcpTokens.findActiveByHash");
  }

  async listForUser(userId: string): Promise<McpTokenRow[]> {
    return unwrap(
      await this.db.from("mcp_tokens").select("*").eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }),
      "mcpTokens.listForUser",
    );
  }

  async revoke(id: string, userId: string, at: Date): Promise<void> {
    assertOk(await this.db.from("mcp_tokens").update({ revoked_at: at.toISOString() }).eq("id", id).eq("user_id", userId), "mcpTokens.revoke");
  }

  async touch(id: string, at: Date): Promise<void> {
    assertOk(await this.db.from("mcp_tokens").update({ last_used_at: at.toISOString() }).eq("id", id), "mcpTokens.touch");
  }
}

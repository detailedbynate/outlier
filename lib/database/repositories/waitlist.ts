import type { DatabaseClient } from "@/lib/database/client";
import { assertOk, toDatabaseError, unwrap, unwrapMaybe } from "@/lib/database/errors";
import type { TablesInsert, WaitlistEntryRow, WaitlistStatus } from "@/types/database";

export class WaitlistRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Insert a signup; returns null when the email is already on the list. */
  async insert(entry: TablesInsert<"waitlist_entries">): Promise<WaitlistEntryRow | null> {
    const result = await this.db.from("waitlist_entries").insert(entry).select("*").single();
    if (result.error?.code === "23505") return null;
    if (result.error) throw toDatabaseError(result.error, "waitlist.insert");
    return result.data;
  }

  async findByEmail(email: string): Promise<WaitlistEntryRow | null> {
    return unwrapMaybe(
      await this.db.from("waitlist_entries").select("*").ilike("email", escapeExact(email)).maybeSingle(),
      "waitlist.findByEmail",
    );
  }

  async findById(id: string): Promise<WaitlistEntryRow | null> {
    return unwrapMaybe(await this.db.from("waitlist_entries").select("*").eq("id", id).maybeSingle(), "waitlist.findById");
  }

  /** 1-based position among everyone who signed up, by signup time. */
  async positionOf(entry: Pick<WaitlistEntryRow, "created_at">): Promise<number> {
    const result = await this.db
      .from("waitlist_entries")
      .select("id", { count: "exact", head: true })
      .lte("created_at", entry.created_at);
    assertOk(result, "waitlist.positionOf");
    return result.count ?? 1;
  }

  async count(status?: WaitlistStatus): Promise<number> {
    let query = this.db.from("waitlist_entries").select("id", { count: "exact", head: true });
    if (status) query = query.eq("status", status);
    const result = await query;
    assertOk(result, "waitlist.count");
    return result.count ?? 0;
  }

  async list(options: { status?: WaitlistStatus; limit: number; search?: string }): Promise<WaitlistEntryRow[]> {
    let query = this.db.from("waitlist_entries").select("*");
    if (options.status) query = query.eq("status", options.status);
    if (options.search) {
      const pattern = `*${options.search.replace(/[\\%_*,()"]/g, "")}*`;
      query = query.or(`email.ilike."${pattern}",name.ilike."${pattern}",niche.ilike."${pattern}"`);
    }
    return unwrap(await query.order("created_at", { ascending: true }).limit(options.limit), "waitlist.list");
  }

  async findByIds(ids: string[]): Promise<WaitlistEntryRow[]> {
    if (ids.length === 0) return [];
    return unwrap(await this.db.from("waitlist_entries").select("*").in("id", ids), "waitlist.findByIds");
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    assertOk(await this.db.from("waitlist_entries").delete().in("id", ids), "waitlist.deleteMany");
  }

  async updateMany(ids: string[], patch: Partial<WaitlistEntryRow>): Promise<void> {
    if (ids.length === 0) return;
    assertOk(await this.db.from("waitlist_entries").update(patch).in("id", ids), "waitlist.updateMany");
  }

  async update(id: string, patch: Partial<WaitlistEntryRow>): Promise<void> {
    assertOk(await this.db.from("waitlist_entries").update(patch).eq("id", id), "waitlist.update");
  }
}

/** ilike without wildcards = case-insensitive exact match. */
function escapeExact(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

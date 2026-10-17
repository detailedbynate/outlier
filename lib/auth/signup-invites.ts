import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { SignupInviteRow } from "@/types/database";

/**
 * Signup links.
 *
 * A new subscriber has an account before they have a password, so they get a
 * link that lets them set one. The link is a random token; only its SHA-256 is
 * stored, so the table is useless to anyone who reads it. It can be opened as
 * many times as they like and has no time limit: it stops working only once the
 * account is set up (see retire), so nobody who paid is locked out by a link
 * that ran out.
 */

/**
 * expires_at is a required column from when links lasted a week. It's no longer
 * checked; links are written as never expiring so the column stays honest.
 */
const NEVER = "infinity";

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class SignupInviteRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Mint a link for this user.
   *
   * Outstanding links are deliberately left alone. Fulfilment runs from both the
   * webhook and the return page, and invalidating the older one meant the first
   * email someone opened was already dead. Every unused link stays good until
   * one of them is spent, which retires the rest.
   */
  async create(userId: string, email: string): Promise<{ token: string }> {
    const token = newToken();
    unwrap(
      await this.db
        .from("signup_invites")
        .insert({ token_hash: await hashToken(token), user_id: userId, email: email.toLowerCase(), expires_at: NEVER })
        .select("token_hash"),
      "signup_invites.create",
    );
    return { token };
  }

  /** Is there already a link in this person's inbox that still works? */
  async hasActive(userId: string): Promise<boolean> {
    const rows = unwrap(
      await this.db
        .from("signup_invites")
        .select("token_hash")
        .eq("user_id", userId)
        .is("used_at", null)
        .limit(1),
      "signup_invites.hasActive",
    );
    return rows.length > 0;
  }

  /** The invite this token stands for, or null when it's unknown or the account is already set up. */
  async find(token: string): Promise<SignupInviteRow | null> {
    if (!token) return null;
    const rows = unwrap(
      await this.db.from("signup_invites").select("*").eq("token_hash", await hashToken(token)).limit(1),
      "signup_invites.find",
    );
    const invite = rows[0];
    return invite && invite.used_at === null ? invite : null;
  }

  /**
   * The account is set up: retire every link this person was sent, so none of
   * them can be used to set the password again.
   */
  async retire(userId: string, now: Date = new Date()): Promise<void> {
    unwrap(
      await this.db.from("signup_invites").update({ used_at: now.toISOString() }).eq("user_id", userId).is("used_at", null).select("token_hash"),
      "signup_invites.retire",
    );
  }
}

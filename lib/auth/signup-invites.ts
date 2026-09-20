import "server-only";
import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";
import type { SignupInviteRow } from "@/types/database";

/**
 * One-time signup links.
 *
 * A new subscriber has an account before they have a password, so they get a
 * link that lets them set one. The link is a random token; only its SHA-256 is
 * stored, so the table is useless to anyone who reads it. It is spent the moment
 * it's used and expires on its own if it isn't.
 */

/** How long a signup link stays good. Long enough to survive a slow inbox, short enough to matter. */
export const INVITE_TTL_MS = 7 * 86_400_000;

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
  async create(userId: string, email: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    unwrap(
      await this.db
        .from("signup_invites")
        .insert({ token_hash: await hashToken(token), user_id: userId, email: email.toLowerCase(), expires_at: expiresAt.toISOString() })
        .select("token_hash"),
      "signup_invites.create",
    );
    return { token, expiresAt };
  }

  /** Is there already a link in this person's inbox that still works? */
  async hasActive(userId: string, now: Date = new Date()): Promise<boolean> {
    const rows = unwrap(
      await this.db
        .from("signup_invites")
        .select("token_hash")
        .eq("user_id", userId)
        .is("used_at", null)
        .gt("expires_at", now.toISOString())
        .limit(1),
      "signup_invites.hasActive",
    );
    return rows.length > 0;
  }

  /** The invite this token stands for, or null when it's unknown, spent or expired. */
  async find(token: string, now: Date = new Date()): Promise<SignupInviteRow | null> {
    if (!token) return null;
    const rows = unwrap(
      await this.db.from("signup_invites").select("*").eq("token_hash", await hashToken(token)).limit(1),
      "signup_invites.find",
    );
    const invite = rows[0];
    if (!invite || invite.used_at !== null) return null;
    return Date.parse(invite.expires_at) > now.getTime() ? invite : null;
  }

  /**
   * Spend the invite. The update is conditional on it still being unused, so two
   * tabs submitting at once can't both succeed.
   */
  async consume(token: string, now: Date = new Date()): Promise<SignupInviteRow | null> {
    const rows = unwrap(
      await this.db
        .from("signup_invites")
        .update({ used_at: now.toISOString() })
        .eq("token_hash", await hashToken(token))
        .is("used_at", null)
        .gt("expires_at", now.toISOString())
        .select("*"),
      "signup_invites.consume",
    );
    const invite = rows[0] ?? null;
    // Signing up retires every other link they were sent, so a duplicate email
    // can't be used to set the password a second time.
    if (invite) {
      await this.db.from("signup_invites").update({ used_at: now.toISOString() }).eq("user_id", invite.user_id).is("used_at", null);
    }
    return invite;
  }
}

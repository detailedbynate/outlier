import "server-only";
import { AppError } from "@/lib/core/errors";
import type { DatabaseClient } from "@/lib/database/client";
import type { AccountProvisioner } from "@/lib/services/account-service";
import type { AuthModeration } from "@/lib/services/moderation-service";
import type { InviteSender } from "@/lib/services/waitlist-service";

const ALREADY_REGISTERED = /already (been )?registered|already exists/i;

/**
 * Invites via Supabase Auth admin. Links land on /auth/confirm, which verifies
 * the token server-side (token_hash flow) and sends new users to set a password.
 *
 * The Supabase "Invite user" email template must link to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
 */
export class SupabaseInviteSender implements InviteSender {
  constructor(private readonly admin: DatabaseClient) {}

  async inviteByEmail(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (!error) return;
    if (ALREADY_REGISTERED.test(error.message)) {
      // Existing account: send a sign-in email instead of failing.
      await sendSignInEmail(this.admin, email, redirectTo);
      return;
    }
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      throw new AppError("RATE_LIMITED", "Supabase's email limit was hit. Use “Copy link” and send it yourself, or set up custom SMTP.");
    }
    throw new AppError("UPSTREAM_ERROR", `Invite failed: ${error.message}`, { cause: error, expose: true });
  }

  async createSignInLink(email: string, redirectTo: string): Promise<string> {
    // New people get an invite link (creates the account); existing accounts get a magic link.
    let type: "invite" | "email" = "invite";
    let result = await this.admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
    if (result.error && ALREADY_REGISTERED.test(result.error.message)) {
      type = "email";
      result = await this.admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
    }
    if (result.error || !result.data.properties?.hashed_token) {
      throw new AppError("UPSTREAM_ERROR", `Could not create a sign-in link: ${result.error?.message ?? "no token"}`, {
        cause: result.error,
        expose: true,
      });
    }
    const url = new URL(redirectTo);
    url.searchParams.set("token_hash", result.data.properties.hashed_token);
    url.searchParams.set("type", type);
    return url.toString();
  }
}

/** Creates accounts for /admin/accounts: an invite email, or a one-time link to send yourself. */
export class SupabaseAccountProvisioner implements AccountProvisioner {
  private readonly invites: SupabaseInviteSender;

  constructor(
    private readonly admin: DatabaseClient,
    private readonly userIdByEmail: (email: string) => Promise<string | null>,
  ) {
    this.invites = new SupabaseInviteSender(admin);
  }

  async provision(email: string, redirectTo: string, delivery: "email" | "link"): Promise<{ userId: string; link: string | null; existed: boolean }> {
    const existingId = await this.userIdByEmail(email);
    if (delivery === "link") {
      const link = await this.invites.createSignInLink(email, redirectTo);
      const userId = existingId ?? (await this.userIdByEmail(email));
      if (!userId) throw new AppError("UPSTREAM_ERROR", "The account was created but couldn't be found yet. Try again in a moment.", { expose: true });
      return { userId, link, existed: existingId !== null };
    }
    if (existingId) {
      // Already has an account: email them a sign-in (magic) link instead of an invite.
      await sendSignInEmail(this.admin, email, redirectTo);
      return { userId: existingId, link: null, existed: true };
    }
    const { data, error } = await this.admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) {
      if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
        throw new AppError("RATE_LIMITED", "The email limit was hit. Choose \"Copy sign-in link\" instead, or finish the Resend SMTP setup.");
      }
      throw new AppError("UPSTREAM_ERROR", `Invite failed: ${error?.message ?? "no user returned"}`, { cause: error, expose: true });
    }
    return { userId: data.user.id, link: null, existed: false };
  }
}

/** Mirrors bans into Supabase Auth so existing sessions can't refresh. */
export class SupabaseAuthModeration implements AuthModeration {
  constructor(private readonly admin: DatabaseClient) {}

  async setBan(userId: string, hours: number | null): Promise<void> {
    // Supabase takes a Go duration; "none" lifts the ban. ~100 years = permanent.
    const ban_duration = hours === 0 ? "none" : `${hours ?? 876_000}h`;
    const { error } = await this.admin.auth.admin.updateUserById(userId, { ban_duration });
    if (error) throw new AppError("UPSTREAM_ERROR", `Auth ban update failed: ${error.message}`, { cause: error });
  }
}

/**
 * Email a one-time sign-in link to an existing account (Supabase "Magic link"
 * template, sent through the configured SMTP provider).
 */
async function sendSignInEmail(client: DatabaseClient, email: string, redirectTo: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  if (!error) return;
  if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
    throw new AppError("RATE_LIMITED", "A sign-in email was sent to this address very recently. Wait a minute and try again, or use \"Copy sign-in link\".");
  }
  throw new AppError("UPSTREAM_ERROR", `Sign-in email failed: ${error.message}`, { cause: error, expose: true });
}
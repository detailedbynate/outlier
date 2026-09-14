import "server-only";
import { AppError } from "@/lib/core/errors";
import type { DatabaseClient } from "@/lib/database/client";
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
      throw new AppError("CONFLICT", "This person already has an account. Use “Copy link” to send them a sign-in link.");
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

import { z } from "zod";
import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { AccountRepository } from "@/lib/database/repositories/accounts";
import type { ModerationRepository } from "@/lib/database/repositories/moderation";
import type { WaitlistRepository } from "@/lib/database/repositories/waitlist";
import { PERMANENT_UNTIL } from "@/lib/moderation/status";
import type { AccountRole, AccountSettingsRow, TablesInsert } from "@/types/database";
import type { Actor } from "./account-service";

/**
 * Bulk moderation for accounts and the waitlist. Every action is permission
 * checked per target (nobody can act on the owner or themselves; only the owner
 * can act on admins) and written to the moderation log.
 */

export const MAX_BULK = 500;

export const ACCOUNT_ACTIONS = ["ban", "temp_ban", "unban", "restrict", "unrestrict", "remove", "set_limits"] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];

const uuid = z.uuid();

export const moderateAccountsSchema = z
  .object({
    action: z.enum(ACCOUNT_ACTIONS),
    userIds: z.array(uuid).min(1, "Select at least one account.").max(MAX_BULK),
    /** For temp_ban / restrict: hours (0 = permanent for restrict). */
    durationHours: z.coerce.number().int().min(0).max(24 * 365 * 5).optional(),
    reason: z.string().trim().max(500).optional().transform((v) => v || null),
    dailyCredits: z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).optional(),
    youtubeDailyUnits: z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "temp_ban" && !v.durationHours) ctx.addIssue({ code: "custom", path: ["durationHours"], message: "Pick how long the suspension lasts." });
  });

export const WAITLIST_ACTIONS = ["remove", "decline", "restore"] as const;
export type WaitlistAction = (typeof WAITLIST_ACTIONS)[number];

export interface BulkResult {
  applied: number;
  skipped: { target: string; reason: string }[];
}

/** Supabase Auth side effects (ban sessions at the auth layer too). Best effort. */
export interface AuthModeration {
  setBan(userId: string, hours: number | null): Promise<void>;
}

type Target = { id: string; email: string; settings: AccountSettingsRow | null };

export class ModerationService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      moderation: Pick<ModerationRepository, "log" | "recent" | "listUsers" | "deleteUser">;
      accounts: Pick<AccountRepository, "findByUserId" | "upsert" | "update">;
      waitlist: Pick<WaitlistRepository, "findByIds" | "deleteMany" | "updateMany">;
      auth?: AuthModeration;
      /** Called after settings change so cached limits refresh. */
      onAccountChanged?: (userId: string) => void;
      isOwnerEmail: (email: string) => boolean;
    },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.moderation" });
  }

  listUsers() {
    return this.deps.moderation.listUsers();
  }

  recentActions(limit = 50) {
    return this.deps.moderation.recent(limit);
  }

  async moderateAccounts(input: unknown, actor: Actor, now: Date = new Date()): Promise<BulkResult> {
    assertManager(actor);
    const parsed = moderateAccountsSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the form.", z.flattenError(parsed.error));
    const data = parsed.data;

    const users = await this.deps.moderation.listUsers();
    const byId = new Map(users.map((u) => [u.id, u]));
    const result: BulkResult = { applied: 0, skipped: [] };
    const logRows: TablesInsert<"moderation_actions">[] = [];

    for (const userId of new Set(data.userIds)) {
      const target = byId.get(userId);
      if (!target) {
        result.skipped.push({ target: userId, reason: "Account not found" });
        continue;
      }
      const denied = this.denyReason(target, actor);
      if (denied) {
        result.skipped.push({ target: target.email, reason: denied });
        continue;
      }
      try {
        const until = await this.applyToAccount(target, data, now);
        logRows.push({
          target_user_id: data.action === "remove" ? null : target.id,
          target_email: target.email,
          action: data.action,
          reason: data.reason,
          until,
          actor_id: actor.userId,
        });
        result.applied += 1;
      } catch (error) {
        this.log.warn("moderation action failed", { action: data.action, userId, error });
        result.skipped.push({ target: target.email, reason: error instanceof AppError && error.expose ? error.message : "Failed" });
      }
    }

    await this.deps.moderation.log(logRows);
    this.log.info("accounts moderated", { action: data.action, applied: result.applied, skipped: result.skipped.length, by: actor.userId });
    return result;
  }

  async moderateWaitlist(action: WaitlistAction, ids: string[], actor: Actor): Promise<BulkResult> {
    assertManager(actor);
    const valid = [...new Set(ids)].filter((id) => uuid.safeParse(id).success).slice(0, MAX_BULK);
    if (valid.length === 0) throw new ValidationError("Select at least one person.");
    const entries = await this.deps.waitlist.findByIds(valid);
    if (entries.length === 0) return { applied: 0, skipped: [] };
    const found = entries.map((e) => e.id);

    if (action === "remove") await this.deps.waitlist.deleteMany(found);
    else if (action === "decline") await this.deps.waitlist.updateMany(found, { status: "declined" });
    else await this.deps.waitlist.updateMany(found, { status: "pending", invited_at: null, invited_by: null });

    if (action !== "restore") {
      await this.deps.moderation.log(
        entries.map((e) => ({ target_email: e.email, action: action === "remove" ? "waitlist_remove" : "waitlist_decline", actor_id: actor.userId }) as const),
      );
    }
    return { applied: entries.length, skipped: [] };
  }

  private denyReason(target: Target, actor: Actor): string | null {
    if (target.id === actor.userId) return "You can't moderate your own account";
    const role: AccountRole = target.settings?.role ?? "member";
    if (role === "owner" || this.deps.isOwnerEmail(target.email)) return "The owner account can't be moderated";
    if (role === "admin" && actor.role !== "owner") return "Only the owner can moderate admins";
    return null;
  }

  /** Returns the `until` recorded in the log. */
  private async applyToAccount(target: Target, data: z.output<typeof moderateAccountsSchema>, now: Date): Promise<string | null> {
    const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
    const ensure = async (patch: Partial<AccountSettingsRow>) => {
      if (target.settings) await this.deps.accounts.update(target.id, patch);
      else await this.deps.accounts.upsert({ user_id: target.id, email: target.email, ...patch });
      this.deps.onAccountChanged?.(target.id);
    };

    switch (data.action) {
      case "ban":
        await ensure({ banned_until: PERMANENT_UNTIL, ban_reason: data.reason });
        await this.authBan(target.id, null);
        return null;
      case "temp_ban": {
        const until = hoursFromNow(data.durationHours!);
        await ensure({ banned_until: until, ban_reason: data.reason });
        await this.authBan(target.id, data.durationHours!);
        return until;
      }
      case "unban":
        await ensure({ banned_until: null, ban_reason: null, disabled: false });
        await this.authBan(target.id, 0);
        return null;
      case "restrict": {
        const until = data.durationHours ? hoursFromNow(data.durationHours) : PERMANENT_UNTIL;
        await ensure({ restricted_until: until, restrict_reason: data.reason });
        return data.durationHours ? until : null;
      }
      case "unrestrict":
        await ensure({ restricted_until: null, restrict_reason: null });
        return null;
      case "set_limits": {
        const patch: Partial<AccountSettingsRow> = {};
        if (data.dailyCredits !== undefined) patch.daily_credits = data.dailyCredits === "" ? null : data.dailyCredits;
        if (data.youtubeDailyUnits !== undefined) patch.youtube_daily_units = data.youtubeDailyUnits === "" ? null : data.youtubeDailyUnits;
        await ensure(patch);
        return null;
      }
      case "remove": {
        // Ban first so an open session can't keep working while the deletion runs.
        await this.authBan(target.id, null);
        const deleted = await this.deps.moderation.deleteUser(target.id);
        if (!deleted) throw new AppError("NOT_FOUND", "Account was already removed");
        this.deps.onAccountChanged?.(target.id);
        return null;
      }
    }
  }

  /** hours: null = permanent, 0 = lift. Failures are logged; the app-level ban already applies. */
  private async authBan(userId: string, hours: number | null): Promise<void> {
    if (!this.deps.auth) return;
    try {
      await this.deps.auth.setBan(userId, hours);
    } catch (error) {
      this.log.warn("auth ban update failed", { userId, error });
    }
  }
}

function assertManager(actor: Actor): void {
  if (actor.role !== "owner" && actor.role !== "admin") throw new AppError("FORBIDDEN", "Admins only.");
}

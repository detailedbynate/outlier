import { z } from "zod";
import { AppError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { AccountRepository } from "@/lib/database/repositories/accounts";
import { moderationState } from "@/lib/moderation/status";
import type { AccountRole, AccountSettingsRow } from "@/types/database";

/**
 * Accounts the owner/admins create and manage: role, monthly credits, YouTube
 * quota, and access. Owners are unlimited and can't be demoted or disabled.
 */

/** Effectively unlimited monthly credits for owners. */
export const OWNER_MONTHLY_CREDITS = 1_000_000;

export interface AccountProvisioner {
  /** Create the auth account (if needed). "email" sends an invite; "link" returns a one-time sign-in link. */
  provision(email: string, redirectTo: string, delivery: "email" | "link"): Promise<{ userId: string; link: string | null; existed: boolean }>;
}

const limitSchema = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const createAccountSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email.").max(254)),
  role: z.enum(["admin", "member"]).default("member"),
  monthlyCredits: limitSchema,
  youtubeDailyUnits: limitSchema,
  note: z.string().trim().max(500).optional().transform((v) => v || null),
  delivery: z.enum(["email", "link"]).default("link"),
});

export const updateAccountSchema = z.object({
  role: z.enum(["owner", "admin", "member"]).optional(),
  monthlyCredits: limitSchema,
  youtubeDailyUnits: limitSchema,
  note: z.string().trim().max(500).optional().transform((v) => v || null),
  disabled: z.boolean().optional(),
  /** Needed to create a settings row for accounts that don't have one yet. */
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
});

export interface Actor {
  userId: string;
  role: AccountRole;
}

export interface AccountLimits {
  role: AccountRole | null;
  disabled: boolean;
  monthlyCredits: number | null;
  /** undefined = tier default; null = no per-user cap. */
  youtubeDailyUnits: number | null | undefined;
  quotaTier: string;
}

const CACHE_MS = 30_000;

export class AccountService {
  private readonly log: Logger;
  private readonly ownerEmails: Set<string>;
  private readonly cache = new Map<string, { at: number; row: AccountSettingsRow | null }>();

  constructor(
    private readonly deps: {
      repository: Pick<AccountRepository, "findByUserId" | "list" | "upsert" | "update" | "userIdByEmail">;
      provisioner: AccountProvisioner;
    },
    config: { ownerEmails: readonly string[] },
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.accounts" });
    this.ownerEmails = new Set(config.ownerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  isOwnerEmail(email: string | null | undefined): boolean {
    return Boolean(email && this.ownerEmails.has(email.toLowerCase()));
  }

  /** Settings for a signed-in user. Creates the owner row on first sign-in for owner emails. */
  async forUser(userId: string, email: string | null): Promise<AccountSettingsRow | null> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.row;
    let row: AccountSettingsRow | null;
    try {
      row = await this.deps.repository.findByUserId(userId);
      if (this.isOwnerEmail(email) && (row?.role !== "owner" || row.disabled)) {
        row = await this.deps.repository.upsert({ user_id: userId, email: email!.toLowerCase(), role: "owner", disabled: false });
        this.log.info("owner account ensured", { userId });
      }
    } catch (error) {
      // Never lock people out because settings can't be read; defaults apply.
      this.log.error("account settings unavailable", { error });
      return null;
    }
    this.cache.set(userId, { at: Date.now(), row });
    return row;
  }

  /** Limits used by credits and YouTube quota checks. */
  async limitsFor(userId: string): Promise<AccountLimits> {
    const row = await this.forUser(userId, null);
    if (!row) return { role: null, disabled: false, monthlyCredits: null, youtubeDailyUnits: undefined, quotaTier: "default" };
    const owner = row.role === "owner";
    const state = moderationState(row);
    if (!owner && state.status !== "active") {
      // Banned or restricted: nothing to spend.
      return { role: row.role, disabled: state.status !== "restricted", monthlyCredits: 0, youtubeDailyUnits: 0, quotaTier: row.quota_tier };
    }
    return {
      role: row.role,
      disabled: row.disabled,
      monthlyCredits: owner ? OWNER_MONTHLY_CREDITS : row.daily_credits,
      youtubeDailyUnits: owner ? null : (row.youtube_daily_units ?? undefined),
      quotaTier: row.quota_tier,
    };
  }

  /** Drop cached settings after an out-of-band change (e.g. moderation). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  list(): Promise<AccountSettingsRow[]> {
    return this.deps.repository.list();
  }

  async create(input: unknown, actor: Actor, redirectTo: string): Promise<{ account: AccountSettingsRow; link: string | null; existed: boolean }> {
    this.assertManager(actor);
    const parsed = createAccountSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the form.", z.flattenError(parsed.error));
    const data = parsed.data;
    if (data.role === "admin" && actor.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can create admins.");
    if (this.isOwnerEmail(data.email)) throw new AppError("CONFLICT", "That's the owner account.");

    const { userId, link, existed } = await this.deps.provisioner.provision(data.email, redirectTo, data.delivery);
    const existing = await this.deps.repository.findByUserId(userId);
    if (existing?.role === "owner") throw new AppError("CONFLICT", "That's the owner account.");
    const account = await this.deps.repository.upsert({
      user_id: userId,
      email: data.email,
      role: data.role,
      daily_credits: data.monthlyCredits,
      youtube_daily_units: data.youtubeDailyUnits,
      note: data.note,
      disabled: false,
      created_by: existing?.created_by ?? actor.userId,
    });
    this.cache.delete(userId);
    this.log.info("account created", { userId, role: data.role, existed, delivery: data.delivery });
    return { account, link, existed };
  }

  async update(userId: string, input: unknown, actor: Actor): Promise<AccountSettingsRow> {
    this.assertManager(actor);
    const parsed = updateAccountSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the form.", z.flattenError(parsed.error));
    const data = parsed.data;
    let target = await this.deps.repository.findByUserId(userId);
    if (!target) {
      if (!data.email) throw new AppError("NOT_FOUND", "Account not found.");
      if (this.isOwnerEmail(data.email)) throw new AppError("FORBIDDEN", "The owner account can't be changed here.");
      target = await this.deps.repository.upsert({ user_id: userId, email: data.email, created_by: actor.userId });
    }

    if (target.role === "owner" && (data.disabled || (data.role && data.role !== "owner"))) {
      throw new AppError("FORBIDDEN", "The owner account can't be demoted or disabled.");
    }
    if (actor.role !== "owner") {
      if (target.role !== "member") throw new AppError("FORBIDDEN", "Only the owner can change admins.");
      if (data.role && data.role !== "member") throw new AppError("FORBIDDEN", "Only the owner can grant admin.");
    }
    if (data.role === "owner" && target.role !== "owner") throw new AppError("FORBIDDEN", "Ownership can't be transferred here.");
    if (userId === actor.userId && data.disabled) throw new AppError("FORBIDDEN", "You can't disable your own account.");

    const updated = await this.deps.repository.update(userId, {
      ...(data.role ? { role: data.role } : {}),
      daily_credits: data.monthlyCredits,
      youtube_daily_units: data.youtubeDailyUnits,
      note: data.note,
      ...(data.disabled !== undefined ? { disabled: data.disabled } : {}),
    });
    this.cache.delete(userId);
    this.log.info("account updated", { userId, by: actor.userId });
    return updated;
  }

  private assertManager(actor: Actor): void {
    if (actor.role !== "owner" && actor.role !== "admin") throw new AppError("FORBIDDEN", "Admins only.");
  }
}

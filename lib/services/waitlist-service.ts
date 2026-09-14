import { z } from "zod";
import { AppError, NotFoundError, ValidationError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { WaitlistRepository } from "@/lib/database/repositories/waitlist";
import type { WaitlistEntryRow } from "@/types/database";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const waitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254)),
  name: optionalText(100),
  channelUrl: optionalText(300),
  niche: optionalText(100),
  useCase: optionalText(500),
  source: optionalText(100),
});

export type WaitlistSignup = z.input<typeof waitlistSignupSchema>;

/** Sends account invites. Implemented with Supabase Auth admin in production; faked in tests. */
export interface InviteSender {
  /** Create the account (if needed) and email an invite. */
  inviteByEmail(email: string, redirectTo: string): Promise<void>;
  /** A one-time sign-in link the admin can send manually (e.g. when email limits are hit). */
  createSignInLink(email: string, redirectTo: string): Promise<string>;
}

export class WaitlistService {
  private readonly log: Logger;

  constructor(
    private readonly repository: WaitlistRepository,
    private readonly invites: InviteSender,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.waitlist" });
  }

  /** Join the waitlist. Signing up twice is not an error: it returns the existing spot. */
  async join(input: WaitlistSignup): Promise<{ entry: WaitlistEntryRow; position: number; alreadyJoined: boolean }> {
    const parsed = waitlistSignupSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid signup", z.flattenError(parsed.error));
    const data = parsed.data;

    const inserted = await this.repository.insert({
      email: data.email,
      name: data.name ?? null,
      channel_url: data.channelUrl ?? null,
      niche: data.niche ?? null,
      use_case: data.useCase ?? null,
      source: data.source ?? null,
    });
    const entry = inserted ?? (await this.repository.findByEmail(data.email));
    if (!entry) throw new AppError("INTERNAL_ERROR", "Waitlist signup could not be saved", { expose: false });

    const position = await this.repository.positionOf(entry);
    if (inserted) this.log.info("waitlist signup", { position });
    return { entry, position, alreadyJoined: !inserted };
  }

  /** Whether an email was invited from the waitlist (grants app access). */
  async isInvited(email: string): Promise<boolean> {
    const entry = await this.repository.findByEmail(email);
    return entry?.status === "invited" || entry?.status === "joined";
  }

  async invite(entryId: string, siteUrl: string, invitedBy: string): Promise<WaitlistEntryRow> {
    const entry = await this.repository.findById(entryId);
    if (!entry) throw new NotFoundError("Waitlist entry", entryId);
    await this.invites.inviteByEmail(entry.email, confirmUrl(siteUrl));
    await this.repository.update(entry.id, { status: "invited", invited_at: new Date().toISOString(), invited_by: invitedBy });
    this.log.info("waitlist invite sent", { entryId });
    return { ...entry, status: "invited" };
  }

  /** Generate a sign-in link to share manually. Also marks the entry invited. */
  async inviteLink(entryId: string, siteUrl: string, invitedBy: string): Promise<string> {
    const entry = await this.repository.findById(entryId);
    if (!entry) throw new NotFoundError("Waitlist entry", entryId);
    const link = await this.invites.createSignInLink(entry.email, confirmUrl(siteUrl));
    if (entry.status === "pending") {
      await this.repository.update(entry.id, { status: "invited", invited_at: new Date().toISOString(), invited_by: invitedBy });
    }
    return link;
  }

  async markJoined(email: string): Promise<void> {
    const entry = await this.repository.findByEmail(email);
    if (entry && entry.status !== "joined") await this.repository.update(entry.id, { status: "joined", joined_at: new Date().toISOString() });
  }
}

function confirmUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/auth/confirm`;
}

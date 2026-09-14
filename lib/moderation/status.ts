import type { AccountSettingsRow } from "@/types/database";

/** Far-future timestamp used for permanent bans. */
export const PERMANENT_UNTIL = "9999-12-31T00:00:00.000Z";

export type AccountStatus = "active" | "banned" | "suspended" | "restricted";

export interface ModerationState {
  status: AccountStatus;
  /** Ban or restriction end (null when active or permanent). */
  until: string | null;
  reason: string | null;
  permanent: boolean;
}

type Moderatable = Pick<AccountSettingsRow, "disabled" | "banned_until" | "ban_reason" | "restricted_until" | "restrict_reason">;

const isFuture = (iso: string | null, now: Date) => iso !== null && Date.parse(iso) > now.getTime();
const isPermanent = (iso: string | null) => iso !== null && Date.parse(iso) >= Date.parse("9000-01-01T00:00:00Z");

/** Current moderation state. Expired bans and restrictions simply stop applying. */
export function moderationState(row: Moderatable | null, now: Date = new Date()): ModerationState {
  if (!row) return { status: "active", until: null, reason: null, permanent: false };
  if (row.disabled || isFuture(row.banned_until, now)) {
    const permanent = row.disabled || isPermanent(row.banned_until);
    return { status: permanent ? "banned" : "suspended", until: permanent ? null : row.banned_until, reason: row.ban_reason, permanent };
  }
  if (isFuture(row.restricted_until, now)) {
    return { status: "restricted", until: isPermanent(row.restricted_until) ? null : row.restricted_until, reason: row.restrict_reason, permanent: isPermanent(row.restricted_until) };
  }
  return { status: "active", until: null, reason: null, permanent: false };
}

/** Durations offered in the moderation UI (hours; 0 = permanent). */
export const DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 0, label: "Permanent" },
] as const;
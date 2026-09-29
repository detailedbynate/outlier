"use server";

import { requireApprovedUser } from "@/lib/auth/session";
import { CHANGELOG_SEEN_KEY } from "@/lib/changelog";
import { currentChangelogVersion } from "@/lib/changelog-version";
import { logger } from "@/lib/core/logger";
import { getAdminDatabase } from "@/lib/database";

/** Remembers on the account that this changelog was seen, so it shows once per person, not once per browser. */
export async function markChangelogSeen(): Promise<void> {
  const current = await requireApprovedUser({ allowIncompleteOnboarding: true });
  if (current.isTestSession) return;
  // The auth server merges user_metadata keys, so other profile fields are kept.
  const version = await currentChangelogVersion();
  const { error } = await getAdminDatabase().auth.admin.updateUserById(current.user.id, { user_metadata: { [CHANGELOG_SEEN_KEY]: version } });
  if (error) logger.warn("could not save changelog as seen", { error: error.message });
}

"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedUser } from "@/lib/auth/session";
import { paidFeaturesLocked } from "@/lib/billing/feature-gate";
import { logger } from "@/lib/core/logger";
import { generateMcpToken, hashMcpToken } from "@/lib/mcp/tokens";
import { getServices } from "@/lib/services";

/** Enough for a laptop, a desktop app and an editor, without a pile of forgotten keys. */
const MAX_TOKENS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateTokenState {
  token: string | null;
  error: string | null;
}

export async function createMcpToken(_prev: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  const current = await requireApprovedUser();
  if (await paidFeaturesLocked(current)) return { token: null, error: "The Outlier MCP server is on the paid plans." };
  const label = String(formData.get("label") ?? "").trim().slice(0, 40) || "MCP";
  const { repositories } = getServices();
  try {
    if ((await repositories.mcpTokens.listForUser(current.user.id)).length >= MAX_TOKENS) {
      return { token: null, error: `You can have ${MAX_TOKENS} tokens. Revoke one you don't use first.` };
    }
    const { token, prefix } = generateMcpToken();
    await repositories.mcpTokens.create({ userId: current.user.id, tokenHash: await hashMcpToken(token), prefix, label, staff: current.isAdmin });
    revalidatePath("/settings/connect-ai");
    return { token, error: null };
  } catch (error) {
    logger.error("mcp token create failed", { error });
    return { token: null, error: "Couldn't make a token just then. Try again." };
  }
}

export async function revokeMcpToken(formData: FormData): Promise<void> {
  const { user } = await requireApprovedUser();
  const id = String(formData.get("id") ?? "");
  if (!UUID_PATTERN.test(id)) return;
  await getServices().repositories.mcpTokens.revoke(id, user.id, new Date());
  revalidatePath("/settings/connect-ai");
}

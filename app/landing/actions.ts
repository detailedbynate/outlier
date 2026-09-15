"use server";

import { cookies, headers } from "next/headers";
import { REFERRAL_COOKIE, referralLinks } from "@/lib/referrals/links";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";

export interface WaitlistState {
  status: "idle" | "joined" | "error";
  message: string | null;
  referral?: { link: string; statusLink: string; signups: number; threshold: number } | null;
}

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
};

export async function joinWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  // Honeypot: real people never see or fill this field.
  if (field(formData, "company")) return { status: "joined", message: "You're on the list!" };

  try {
    const services = getServices();
    await services.rateLimits.enforce("waitlistIp", clientIpFrom(await headers()));
    const { entry, alreadyJoined } = await services.waitlist.join({
      email: field(formData, "email") ?? "",
      name: field(formData, "name"),
      channelUrl: field(formData, "channelUrl"),
      niche: field(formData, "niche"),
      useCase: field(formData, "useCase"),
      source: field(formData, "source"),
    });
    const refCode = field(formData, "ref") || (await cookies()).get(REFERRAL_COOKIE)?.value || null;
    let referral: WaitlistState["referral"] = null;
    try {
      const code = await services.referrals.recordSignup(entry, refCode, !alreadyJoined);
      const [links, status] = await Promise.all([referralLinks(code), services.referrals.publicStatus(code)]);
      referral = { link: links.share, statusLink: links.status, signups: status?.signups ?? 0, threshold: status?.threshold ?? 3 };
    } catch (error) {
      // The signup itself succeeded; referral extras are best effort.
      logger.warn("waitlist referral setup failed", { error });
    }
    return {
      status: "joined",
      message: alreadyJoined ? "You're already on the list. Share your link to move up." : "You're on the list! Share your link to skip the line.",
      referral,
    };
  } catch (error) {
    if (isAppError(error) && (error.code === "VALIDATION_ERROR" || error.code === "RATE_LIMITED")) {
      return { status: "error", message: error.message };
    }
    logger.error("waitlist signup failed", { error });
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

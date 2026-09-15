"use server";

import { headers } from "next/headers";
import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";
import { clientIpFrom } from "@/lib/services/rate-limit-service";

export interface WaitlistState {
  status: "idle" | "joined" | "error";
  message: string | null;
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
    const { alreadyJoined } = await services.waitlist.join({
      email: field(formData, "email") ?? "",
      name: field(formData, "name"),
      channelUrl: field(formData, "channelUrl"),
      niche: field(formData, "niche"),
      useCase: field(formData, "useCase"),
      source: field(formData, "source"),
    });
    return {
      status: "joined",
      message: alreadyJoined ? "You're already on the list. We'll email you when your invite is ready." : "You're on the list! We'll email you when your invite is ready.",
    };
  } catch (error) {
    if (isAppError(error) && (error.code === "VALIDATION_ERROR" || error.code === "RATE_LIMITED")) {
      return { status: "error", message: error.message };
    }
    logger.error("waitlist signup failed", { error });
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

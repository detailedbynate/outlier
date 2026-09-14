"use server";

import { isAppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { getServices } from "@/lib/services";

export interface WaitlistState {
  status: "idle" | "joined" | "error";
  message: string | null;
  position: number | null;
}

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
};

export async function joinWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  // Honeypot: real people never see or fill this field.
  if (field(formData, "company")) return { status: "joined", message: "You're on the list!", position: null };

  try {
    const { position, alreadyJoined } = await getServices().waitlist.join({
      email: field(formData, "email") ?? "",
      name: field(formData, "name"),
      channelUrl: field(formData, "channelUrl"),
      niche: field(formData, "niche"),
      useCase: field(formData, "useCase"),
      source: field(formData, "source"),
    });
    return {
      status: "joined",
      position,
      message: alreadyJoined ? "You're already on the list. We'll email you when your invite is ready." : "You're on the list! We'll email you when your invite is ready.",
    };
  } catch (error) {
    if (isAppError(error) && error.code === "VALIDATION_ERROR") return { status: "error", message: error.message, position: null };
    logger.error("waitlist signup failed", { error });
    return { status: "error", message: "Something went wrong. Please try again.", position: null };
  }
}

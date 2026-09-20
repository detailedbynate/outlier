import "server-only";
import { env } from "@/lib/core/env";
import { AppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";

/**
 * The few emails Outlier sends itself, through Resend.
 *
 * Sign-in and password-reset mail still goes through Supabase Auth. This is for
 * the ones that carry our own content, where Supabase's templates don't fit —
 * today that's the signup link a new subscriber gets after paying.
 */

export function emailEnabled(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const key = env().RESEND_API_KEY;
  if (!key) throw new AppError("CONFIG_ERROR", "Email isn't set up.", { expose: false });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env().EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AppError("UPSTREAM_ERROR", `Email failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  logger.info("email sent", { to: input.to.replace(/(.).*(@.*)/, "$1***$2"), subject: input.subject });
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email a new subscriber gets: one button, one link, and what happens next. */
export function signupEmail(input: { planName: string; url: string; days: number }): { subject: string; html: string; text: string } {
  const url = escape(input.url);
  const subject = `Set up your Outlier account`;
  const text = [
    `You're on Outlier ${input.planName}. Thanks for subscribing.`,
    ``,
    `Finish setting up your account here — you'll pick a password, and it takes a few seconds:`,
    input.url,
    ``,
    `This link works once and expires in ${input.days} days. If it runs out, ask for a new one from the sign-in page.`,
    ``,
    `Outlier · useoutlier.online`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#14141c;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:36px 32px;">
        <tr><td style="color:#ffffff;font-size:22px;font-weight:700;padding-bottom:14px;">You're in.</td></tr>
        <tr><td style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.6;padding-bottom:12px;">
          Thanks for subscribing to Outlier <strong style="color:#ffffff;">${escape(input.planName)}</strong>. One step left: pick a password and your account is ready.
        </td></tr>
        <tr><td style="padding:18px 0 8px;">
          <a href="${url}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:999px;">Set up my account</a>
        </td></tr>
        <tr><td style="color:rgba(255,255,255,0.45);font-size:12.5px;line-height:1.6;padding-top:14px;">
          This link works once and expires in ${input.days} days. If the button doesn't work, paste this into your browser:<br>
          <a href="${url}" style="color:#a78bfa;word-break:break-all;">${url}</a>
        </td></tr>
      </table>
      <div style="color:rgba(255,255,255,0.3);font-size:12px;padding-top:18px;">Outlier · useoutlier.online</div>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

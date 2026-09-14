/** Minimal shape of the Sentry event fields we scrub (avoids importing Sentry types here). */
interface ScrubbableEvent {
  request?: { cookies?: unknown; headers?: Record<string, string>; data?: unknown; query_string?: unknown };
  user?: { email?: string; ip_address?: string | null; [key: string]: unknown };
}

const SENSITIVE_HEADER = /^(authorization|cookie|x-api-key|x-supabase|cf-connecting-ip|x-forwarded-for|x-real-ip)$/i;

/** Strip credentials, cookies, IPs, request bodies, and emails before events leave the app. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADER.test(name)) delete event.request.headers[name];
      }
    }
  }
  if (event.user) {
    delete event.user.email;
    event.user.ip_address = null;
  }
  return event;
}

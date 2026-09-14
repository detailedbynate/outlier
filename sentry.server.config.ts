import * as Sentry from "@sentry/nextjs";
import { registerErrorReporter } from "@/lib/core/error-reporting";
import { scrubEvent } from "@/lib/core/sentry-scrub";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  // Monitoring stays off until a DSN is configured.
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});

if (dsn) {
  // Errors our logger records (handled failures in jobs, services, actions) go to Sentry too.
  registerErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context });
  });
}

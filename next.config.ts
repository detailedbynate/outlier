import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages that should never be bundled into client code.
  serverExternalPackages: ["@electric-sql/pglite"],
};

/**
 * Sentry wraps the build to connect error reports to source code. Source maps are
 * uploaded only when SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT are set.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});

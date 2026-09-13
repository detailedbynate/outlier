import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages that should never be bundled into client code.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;

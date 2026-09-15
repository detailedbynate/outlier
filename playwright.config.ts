import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Uses the Microsoft Edge already installed on Windows
 * (no browser download). Starts its own dev server on port 3100 with a
 * one-off test sign-in token.
 */

const PORT = 3100;
const token = process.env.E2E_AUTH_TOKEN ?? randomBytes(24).toString("hex");
process.env.E2E_AUTH_TOKEN = token;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: "msedge", viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { channel: "msedge", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `node --use-system-ca node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_AUTH_TOKEN: token, NODE_OPTIONS: "--use-system-ca" },
  },
});
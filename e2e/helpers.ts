import { expect, type Page, type TestInfo } from "@playwright/test";

export const E2E_COOKIE = "outlier_e2e";

/** Sign in as the owner via the test-only cookie (see lib/auth/e2e.ts). */
export async function signIn(page: Page, baseURL: string | undefined) {
  const token = process.env.E2E_AUTH_TOKEN;
  if (!token) throw new Error("E2E_AUTH_TOKEN is not set (playwright.config.ts sets it)");
  await page.context().addCookies([{ name: E2E_COOKIE, value: token, url: baseURL ?? "http://localhost:3100" }]);
}

/** Collect uncaught page errors and console errors (ignoring noisy third-party ones). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/i\.ytimg\.com|yt3\.ggpht|Failed to load resource|favicon|Download the React DevTools/i.test(text)) return;
    errors.push(`console: ${text.slice(0, 300)}`);
  });
  return errors;
}

/** The page never scrolls sideways, and nothing outside scrollable tables spills past the screen. */
export async function expectNoHorizontalOverflow(page: Page) {
  // Let entrance animations finish so transforms don't skew measurements.
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const scroll = document.documentElement.scrollWidth - width;
    const offenders = [...document.querySelectorAll("main *")]
      // Scrollable strips and the landing marquee move sideways on purpose; closed menus aren't shown.
      .filter((el) => !el.closest(".table-wrap, .shorts-strip, .dash-shorts, .intel-tabs, .intel-sort-links, .dash-topics, .chips, .popular-row, .marquee, details:not([open]) > :not(summary)"))
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(" ")[0]}`)
      .slice(0, 5);
    return { scroll, offenders };
  });
  expect(result.scroll, `page scrolls sideways; offenders: ${result.offenders.join(", ")}`).toBeLessThanOrEqual(1);
  expect(result.offenders, "elements spill past the screen").toEqual([]);
}

export const isMobile = (testInfo: TestInfo) => testInfo.project.name === "mobile";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isMobile, signIn, watchErrors } from "./helpers";

/** Signed-in pages that only read stored data (no YouTube calls, no writes). */
const PAGES: { path: string; heading: RegExp }[] = [
  { path: "/", heading: /welcome back/i },
  { path: "/research/niche-finder", heading: /niche finder/i },
  { path: "/research/shorts-channels", heading: /shorts channels/i },
  { path: "/viral", heading: /viral/i },
  { path: "/analyze", heading: /analyze/i },
  { path: "/channels", heading: /tracked channels/i },
  { path: "/compare", heading: /competitors/i },
  { path: "/settings/preferences", heading: /preferences/i },
  { path: "/admin/accounts", heading: /accounts/i },
  { path: "/admin/waitlist", heading: /waitlist/i },
];

test.describe("signed-in pages", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page, baseURL);
  });

  for (const { path, heading } of PAGES) {
    test(`${path} renders without errors and fits the screen`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading);
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }

  test("mobile menu opens, navigates, and closes", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), "phone-only menu");
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.locator(".sidebar-nav").getByRole("link", { name: "Competitors" }).click();
    await expect(page).toHaveURL(/\/compare/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".sidebar")).not.toHaveAttribute("data-open", "");
  });

  test("desktop shows the full sidebar and no menu button", async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), "desktop-only layout");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    await expect(page.locator(".sidebar-nav").getByRole("link", { name: "Niche Finder" })).toBeVisible();
  });

  test("dropdown menus stay on screen when opened", async ({ page }) => {
    await page.goto("/research/shorts-channels");
    await page.locator("summary", { hasText: "Sorted by" }).click();
    const panel = page.locator("details[open] .dropdown-panel");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  });

  test("competitor tabs switch sections", async ({ page }) => {
    await page.goto("/compare");
    const tabs = page.getByRole("navigation", { name: "Competitor sections" });
    test.skip((await tabs.count()) === 0, "no competitors saved for the owner account");
    await tabs.getByRole("link", { name: /growth/i }).click();
    await expect(page).toHaveURL(/view=growth/);
    await expect(page.getByRole("heading", { name: "Growth", level: 2 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
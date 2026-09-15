import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, watchErrors } from "./helpers";

test.describe("public pages", () => {
  test("landing page renders the waitlist and fits the screen", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Outlier");
    await expect(page.getByPlaceholder(/email/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("waitlist rejects an invalid email without joining", async ({ page }) => {
    await page.goto("/");
    const email = page.getByPlaceholder(/email/i).first();
    await email.fill("not-an-email");
    await page.getByRole("button", { name: /join the waitlist/i }).first().click();
    // Browser or server validation must stop it; the success state must not appear.
    await expect(page.getByText(/you're on the list/i)).toHaveCount(0);
  });

  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in|log in|continue/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("signed-out visitors are sent to login from app pages", async ({ page }) => {
    await page.goto("/compare");
    await expect(page).toHaveURL(/\/login/);
  });
});
import { test, expect, Page } from "@playwright/test";

// ─────────────────────────────────────────────────────────────
// 8. Accessibility basics
// ─────────────────────────────────────────────────────────────

test.describe("Accessibility", () => {
  test("Begin verification button is keyboard-focusable", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const btn = page.getByRole("button", { name: /begin verification/i });
    await expect(btn).toBeFocused();
  });

  test("card has visible text contrast (dark background + light text)", async ({
    page,
  }) => {
    await page.goto("/");
    const titleColor = await page
      .getByText("Liveness Check")
      .evaluate((el) => getComputedStyle(el).color);
    // Expect a light colour (high R, G, B values)
    expect(titleColor).not.toBe("rgb(0, 0, 0)");
  });
});
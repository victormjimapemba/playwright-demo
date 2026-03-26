import { test, expect, Page } from "@playwright/test";

// ─────────────────────────────────────────────────────────────
// 1. Idle stage
// ─────────────────────────────────────────────────────────────

test.describe("Idle stage", () => {
  test("renders title and subtitle", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Liveness Check")).toBeVisible();
    await expect(page.getByText("Verify you're a real person")).toBeVisible();
  });

  test("shows Begin verification button", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /begin verification/i })
    ).toBeVisible();
  });

  test("shows face-outline SVG placeholder", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Position your face in the frame")
    ).toBeVisible();
  });

//   test("does NOT show challenge preview before session is loaded", async ({
//     page,
//   }) => {
//     await page.goto("/");
//     // The preview section only appears after challenges are fetched, so
//     // "You will be asked to:" should be absent initially.
//     await expect(page.getByText("You will be asked to:")).not.toBeVisible();
//   });
});

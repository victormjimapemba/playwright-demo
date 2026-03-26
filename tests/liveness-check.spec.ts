import { test, expect, Page } from "@playwright/test";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Grant camera permission and stub getUserMedia so no real camera is needed. */
async function grantFakeCamera(page: Page) {
  await page.context().grantPermissions(["camera"]);

  await page.addInitScript(() => {
    // Minimal canvas-based fake stream (black 640×480 @ 30 fps)
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 640,
      height: 480,
    });
    const ctx = canvas.getContext("2d")!;
    setInterval(() => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 640, 480);
    }, 33);

    const fakeStream = (canvas as any).captureStream(30) as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: async () => fakeStream,
      },
    });

    // Also stub MediaRecorder to emit one chunk then stop cleanly
    (window as any).MediaRecorder = class FakeMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: any) => void) | null = null;
      onstop: (() => void) | null = null;
      private _timer: ReturnType<typeof setTimeout> | null = null;

      constructor(public stream: MediaStream, public options: any) {}

      start(timeslice?: number) {
        this.state = "recording";
        // Emit a tiny blob after 200 ms so chunksRef is never empty
        this._timer = setTimeout(() => {
          this.ondataavailable?.({
            data: new Blob(["fake"], { type: "video/webm" }),
          });
        }, 200);
      }

      stop() {
        if (this._timer) clearTimeout(this._timer);
        this.state = "inactive";
        // Fire ondataavailable one last time then onstop
        this.ondataavailable?.({
          data: new Blob(["fake"], { type: "video/webm" }),
        });
        setTimeout(() => this.onstop?.(), 0);
      }
    };
  });
}

/** Intercept /api/liveness/new-session and return two canned challenges. */
function mockNewSession(page: Page, challenges = ["blink_twice", "smile"]) {
  return page.route("**/api/liveness/new-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session_id: "test-session-001",
        challenges,
      }),
    });
  });
}

/** Intercept /api/liveness/verify and return a passing result. */
function mockVerifyPass(page: Page, challenges = ["blink_twice", "smile"]) {
  return page.route("**/api/liveness/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        live: true,
        challenges: challenges.map((name) => ({ name, passed: true })),
      }),
    });
  });
}

/** Intercept /api/liveness/verify and return a failing result. */
function mockVerifyFail(
  page: Page,
  challenges = ["blink_twice", "smile"],
  details: string[] = ["No blink detected", "Smile not detected"]
) {
  return page.route("**/api/liveness/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        live: false,
        challenges: challenges.map((name, i) => ({
          name,
          passed: false,
          detail: details[i] ?? "Not detected",
        })),
      }),
    });
  });
}


// ─────────────────────────────────────────────────────────────
// 2. Starting a session
// ─────────────────────────────────────────────────────────────

test.describe("Starting a session", () => {
  test("fetches challenges and shows preview after clicking Begin", async ({
    page,
  }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "turn_left"]);
    await page.goto("/");

    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(page.getByText("You will be asked to:")).toBeVisible();
    await expect(page.getByText("Blink twice")).toBeVisible();
    await expect(page.getByText("Turn head left")).toBeVisible();
  });

  test("shows GET READY overlay during prepare stage", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page);
    await page.goto("/");

    await page.getByRole("button", { name: /begin verification/i }).click();

    // The "Get ready…" overlay appears briefly during the preparing stage
    await expect(page.getByText("Get ready…")).toBeVisible();
  });

  test("shows error banner when server is unreachable", async ({ page }) => {
    await page.goto("/");

    // No route mock → fetch will fail
    await page.route("**/api/liveness/new-session", (route) =>
      route.abort("connectionrefused")
    );

    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(
      page.getByText(/could not reach server/i)
    ).toBeVisible();
  });

  test("shows error banner on camera denial", async ({ page }) => {
    await mockNewSession(page);
    await page.goto("/");

    // Override getUserMedia to reject
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        writable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException("Permission denied", "NotAllowedError");
          },
        },
      });
    });

    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(
      page.getByText(/camera access denied/i)
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Recording / challenge stages
// ─────────────────────────────────────────────────────────────

test.describe("Challenge recording", () => {
  test("shows REC indicator while recording", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    await mockVerifyPass(page, ["blink_twice", "smile"]);
    await page.goto("/");

    await page.getByRole("button", { name: /begin verification/i }).click();

    // Wait for challenge stage
    await expect(page.getByText("REC")).toBeVisible({ timeout: 3000 });
  });

  test("displays first challenge icon and label", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    await mockVerifyPass(page, ["blink_twice", "smile"]);
    await page.goto("/");

    await page.getByRole("button", { name: /begin verification/i }).click();

    // First challenge label
    await expect(
      page.getByText("BLINK TWICE", { exact: false })
    ).toBeVisible({ timeout: 3000 });
  });

  test("switches to second challenge after half duration", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    await mockVerifyPass(page, ["blink_twice", "smile"]);
    await page.goto("/");

    await page.getByRole("button", { name: /begin verification/i }).click();

    // Wait for second challenge (appears after ~2500 ms)
    await expect(page.getByText("SMILE", { exact: false })).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows Analysing spinner after recording stops", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    // Hold the verify request so we can observe the processing state
    await page.route("**/api/liveness/verify", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          live: true,
          challenges: [
            { name: "blink_twice", passed: true },
            { name: "smile", passed: true },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(page.getByText("Analysing…")).toBeVisible({ timeout: 7000 });
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Success stage
// ─────────────────────────────────────────────────────────────

test.describe("Success stage", () => {
  async function reachSuccess(
    page: Page,
    challenges = ["blink_twice", "smile"]
  ) {
    await grantFakeCamera(page);
    await mockNewSession(page, challenges);
    await mockVerifyPass(page, challenges);
    await page.goto("/");
    await page.getByRole("button", { name: /begin verification/i }).click();
    await expect(page.getByText("Liveness confirmed")).toBeVisible({
      timeout: 10000,
    });
  }

  test("shows Liveness confirmed message", async ({ page }) => {
    await reachSuccess(page);
  });

  test("shows ✓ for each passed challenge", async ({ page }) => {
    await reachSuccess(page, ["blink_twice", "smile"]);
    const checks = page.locator("text=✓");
    await expect(checks).toHaveCount(3); // header + 2 challenges
  });

  test("shows disabled Verified button", async ({ page }) => {
    await reachSuccess(page);
    const btn = page.getByRole("button", { name: /✓ verified/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("does NOT show Try again button on success", async ({ page }) => {
    await reachSuccess(page);
    await expect(
      page.getByRole("button", { name: /try again/i })
    ).not.toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Failure stage
// ─────────────────────────────────────────────────────────────

test.describe("Failure stage", () => {
  async function reachFailure(page: Page) {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    await mockVerifyFail(page, ["blink_twice", "smile"], [
      "No blink detected",
      "Smile not detected",
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: /begin verification/i }).click();
    await expect(page.getByText("Verification failed")).toBeVisible({
      timeout: 10000,
    });
  }

  test("shows Verification failed message", async ({ page }) => {
    await reachFailure(page);
  });

  test("shows failure detail strings for each challenge", async ({ page }) => {
    await reachFailure(page);
    await expect(page.getByText("No blink detected")).toBeVisible();
    await expect(page.getByText("Smile not detected")).toBeVisible();
  });

  test("shows Try again button", async ({ page }) => {
    await reachFailure(page);
    await expect(
      page.getByRole("button", { name: /try again/i })
    ).toBeVisible();
  });

  test("shows attempts counter after first failure", async ({ page }) => {
    await reachFailure(page);
    await expect(page.getByText(/attempt 1/i)).toBeVisible();
  });

  test("resets to idle when Try again is clicked", async ({ page }) => {
    await reachFailure(page);
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(
      page.getByRole("button", { name: /begin verification/i })
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Retry flow
// ─────────────────────────────────────────────────────────────

test.describe("Retry flow", () => {
  test("issues new challenges on retry", async ({ page }) => {
    await grantFakeCamera(page);

    let callCount = 0;
    await page.route("**/api/liveness/new-session", async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: `session-${callCount}`,
          challenges:
            callCount === 1
              ? ["blink_twice", "smile"]
              : ["turn_left", "open_mouth"],
        }),
      });
    });

    await mockVerifyFail(page, ["blink_twice", "smile"]);
    await page.goto("/");

    // First attempt
    await page.getByRole("button", { name: /begin verification/i }).click();
    await expect(page.getByText("Verification failed")).toBeVisible({
      timeout: 10000,
    });

    // Retry — now expect different challenges
    await page.getByRole("button", { name: /try again/i }).click();
    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(page.getByText("Turn head left")).toBeVisible({
      timeout: 3000,
    });
    expect(callCount).toBe(2);
  });

  test("increments attempt counter across retries", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page, ["blink_twice", "smile"]);
    await mockVerifyFail(page, ["blink_twice", "smile"]);
    await page.goto("/");

    for (let i = 1; i <= 2; i++) {
      if (i === 1) {
        await page.getByRole("button", { name: /begin verification/i }).click();
      } else {
        await page.getByRole("button", { name: /try again/i }).click();
        await page.getByRole("button", { name: /begin verification/i }).click();
      }
      await expect(page.getByText("Verification failed")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(new RegExp(`attempt ${i}`, "i"))).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Server error handling
// ─────────────────────────────────────────────────────────────

test.describe("Server error handling", () => {
  test("shows error on 500 from verify endpoint", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page);
    await page.route("**/api/liveness/verify", async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(page.getByText(/server error 500/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Verification failed")).toBeVisible();
  });

  test("shows error field from JSON error response", async ({ page }) => {
    await grantFakeCamera(page);
    await mockNewSession(page);
    await page.route("**/api/liveness/verify", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Face not detected in video",
          live: false,
          challenges: [],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /begin verification/i }).click();

    await expect(
      page.getByText("Face not detected in video")
    ).toBeVisible({ timeout: 10000 });
  });
});

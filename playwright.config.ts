// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],                                        // console output
    ["junit", { outputFile: "test-results/results.xml" }],  // for Azure
    ["html",  { outputFolder: "playwright-report" }],       // browsable report
  ],
  testDir: "./tests",
  use: { 
    baseURL: "http://localhost:5173",
    screenshot: 'only-on-failure',
   },
  webServer: {
    command: "npm run dev",      // or "yarn dev" / "pnpm dev"
    url: "http://localhost:5173",
    reuseExistingServer: true, // reuse if already running locally
    timeout: 30_000,
  },
});
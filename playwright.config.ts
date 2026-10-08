import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // One worker: specs share one local server and database; parallel load made timings flaky.
  workers: 1,
  retries: 0,
  // Server actions (upload, scan, audit) can take a few seconds late in a long local run.
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Runs the production build against the dedicated E2E database (never the dev data).
    // Prepares (creates if missing, migrates, seeds) the E2E database first.
    command: `npx tsx tests/e2e/prepare-db.ts && npx next start -p ${PORT}`,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      // The assistant talks to a stand-in for OpenRouter that the assistant spec starts on this port, never to the real service.
      LLM_ASSISTANT_ENABLED: "true",
      OPENROUTER_API_KEY: "sk-or-e2e-stub-key",
      OPENROUTER_BASE_URL: "http://127.0.0.1:3199",
    },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

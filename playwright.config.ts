import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    launchOptions: {
      executablePath: process.env.CI ? undefined : "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/fixture-supabase.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run start -- --port 3000",
      url: "http://127.0.0.1:3000/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        SUPABASE_SECRET_KEY: "synthetic-test-server-key",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-test-publishable-key",
        LIFE_OS_ALLOWED_EMAIL: "beta@example.invalid",
        LIFE_OS_APP_ORIGIN: "http://127.0.0.1:3000",
      },
    },
  ],
});

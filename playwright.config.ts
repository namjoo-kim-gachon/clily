import { defineConfig, devices } from "@playwright/test"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env" })

const appPort = 3100
const baseURL = `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `TERMINAL_E2E_MODE=mock npm run dev -- --port ${appPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iphone-14",
      use: {
        ...devices["iPhone 14"],
        browserName: "chromium",
      },
    },
    {
      name: "ipad-pro-11",
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium",
      },
    },
  ],
})

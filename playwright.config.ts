// End-to-end smoke test of the core loop in a real browser: npm run test:e2e.
// Point it at a running site with E2E_URL (a dev server, a deploy preview); without it, Playwright starts the
// dev server itself on port 4188 (or E2E_PORT, when another worktree's server already has 4188).
import { defineConfig, devices } from '@playwright/test'

const url = process.env.E2E_URL
const port = process.env.E2E_PORT ?? '4188'
// E2E_CHANNEL=msedge (or chrome) uses an installed browser instead of Playwright's own Chromium, and
// E2E_BROWSER=<path to chrome.exe> another copy of it.
const channel = process.env.E2E_CHANNEL
const executablePath = process.env.E2E_BROWSER
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL: url ?? `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(channel ? { channel } : {}), ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
  webServer: url ? undefined : { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 180_000 },
})

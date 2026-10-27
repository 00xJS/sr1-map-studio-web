// End-to-end smoke test of the core loop in a real browser: npm run test:e2e.
// Point it at a running site with E2E_URL (a dev server, a deploy preview); without it, Playwright starts the
// dev server itself on port 4188.
import { defineConfig, devices } from '@playwright/test'

const url = process.env.E2E_URL
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL: url ?? 'http://localhost:4188', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: url ? undefined : { command: 'npm run dev -- --port 4188 --strictPort', url: 'http://localhost:4188', reuseExistingServer: true, timeout: 180_000 },
})

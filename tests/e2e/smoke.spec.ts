// The core loop a new visitor takes: home → make a map with the wizard → editor → walk it → play it in the
// browser. Labels are matched loosely so renamed buttons ("Play here" / "Play in browser") still pass.
import { expect, test } from '@playwright/test'

test('make a map, walk it and play it in the browser', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('maps in your browser')
  await page.getByRole('button', { name: /make your first map/i }).click()

  const dialog = page.getByRole('dialog', { name: /start a map|generate/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /create this map/i }).first().click()

  await page.waitForURL(/\/editor\//, { timeout: 90_000 })
  await expect(page.getByRole('button', { name: /walk/i }).first()).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()

  // Walk the map, then stop.
  await page.getByRole('button', { name: /^🚶 walk$|^walk$/i }).first().click()
  await expect(page.getByText(/walking the map/i)).toBeVisible()
  await page.getByRole('button', { name: /stop walking/i }).click()
  await expect(page.getByText(/walking the map/i)).toBeHidden()

  // Play it in the browser.
  await page.getByRole('button', { name: /play (here|in (the )?browser)/i }).first().click()
  await page.waitForURL(/\/play\//)
  await expect(page.getByRole('button', { name: /free roam/i })).toBeVisible()

  expect(errors).toEqual([])
})

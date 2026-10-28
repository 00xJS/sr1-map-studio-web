// The editor shell: the top bar on one row at 1280 px, the four side tabs, the inspector on top of them,
// Ctrl+K, and the phone layout. With E2E_SHOTS=<folder> it also saves screenshots at 1440, 1280 and 375 px.
import { expect, test, type Page } from '@playwright/test'

const shots = process.env.E2E_SHOTS
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }

async function makeMap(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /make your first map/i }).click()
  const dialog = page.getByRole('dialog', { name: /start a map|generate/i })
  await dialog.getByRole('button', { name: /create this map/i }).first().click()
  await page.waitForURL(/\/editor\//, { timeout: 90_000 })
  await expect(page.locator('.editor-bar')).toBeVisible({ timeout: 60_000 })
  // The tour and the first-map tips cover the view: put them away.
  const close = page.getByRole('button', { name: /^(skip|close|done)/i }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  const tips = page.getByRole('button', { name: /hide these tips/i })
  if (await tips.isVisible().catch(() => false)) await tips.click()
}

test('the editor shell at 1440 and 1280 px', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('sr1-tour-done', '1') } catch { /* none */ } })
  await makeMap(page)

  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 860 })
    const bar = page.locator('.editor-bar')
    const box = (await bar.boundingBox())!
    // One row: about one button high, and nothing pushed past the right edge.
    expect(box.height).toBeLessThan(56)
    const more = (await page.getByRole('button', { name: 'More', exact: true }).boundingBox())!
    expect(more.x + more.width).toBeLessThanOrEqual(width)
    await expect(page.getByRole('button', { name: /install in game/i }).first()).toBeVisible()
    await shot(page, `editor-${width}`)
  }

  // Four tabs, and a click in the object list puts the inspector on top without changing tab.
  for (const name of ['Build', 'Check', 'Game', 'Ship']) await expect(page.getByRole('tab', { name: new RegExp('^' + name) })).toBeVisible()
  await page.getByRole('tab', { name: /^Build/ }).click()
  await page.locator('[aria-label="Everything in your map"] button.list-item').first().click()
  await expect(page.getByRole('region', { name: 'Selected' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Build/ })).toHaveAttribute('aria-selected', 'true')
  await shot(page, 'editor-1280-selected')

  await page.getByRole('tab', { name: /^Check/ }).click()
  await shot(page, 'editor-1280-check')

  // Ctrl+K finds a setting and takes you to it.
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: /find anything/i })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('weather')
  await shot(page, 'editor-1280-palette')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(page.getByRole('tab', { name: /^Game/ })).toHaveAttribute('aria-selected', 'true')

  // Ctrl+K again closes it.
  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await page.keyboard.press('Control+k')
  await expect(palette).toBeHidden()

  // "Remove invisible walls" lands on its line in the Check tab.
  await page.keyboard.press('Control+k')
  await palette.getByRole('combobox').fill('remove invisible')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: /^Check/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-setting="Remove invisible walls"]')).toBeInViewport()

  // The single checks run without a health check.
  await page.getByRole('button', { name: 'Find invisible walls' }).click()
  await expect(page.getByText(/^(Found \d+: see the list\.|No invisible walls on this map\.)$/)).toBeVisible({ timeout: 60_000 })
  await shot(page, 'editor-1280-check-find')

  // Any kind of marker, added where the camera looks.
  await page.getByRole('tab', { name: /^Build/ }).click()
  const heading = page.getByText(/^Spawns and pickups \(\d+\)$/)
  const count = async () => +(/\((\d+)\)/.exec((await heading.textContent()) ?? '')?.[1] ?? 0)
  const before = await count()
  await page.getByRole('button', { name: /Any kind of marker, or at the camera/ }).click()
  await page.getByRole('combobox', { name: 'Kind of marker' }).selectOption({ index: 0 })
  await page.getByRole('button', { name: '+ At the camera' }).click()
  await expect.poll(count).toBe(before + 1)
  await shot(page, 'editor-1280-any-marker')

  expect(errors).toEqual([])
})

test('the phone editor at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await makeMap(page)
  await expect(page.getByText(/best on a computer/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /play this map/i })).toBeVisible()
  await shot(page, 'editor-375')
  await page.getByRole('button', { name: /tools/i }).first().click()
  await expect(page.locator('.tools-sheet')).toBeVisible()
  await shot(page, 'editor-375-tools')
  await page.getByRole('button', { name: /close tools/i }).click()
  await page.getByRole('button', { name: /panel/i }).first().click()
  await expect(page.getByRole('tab', { name: /^Check/ })).toBeVisible()
  await shot(page, 'editor-375-panel')

  // Something picked, then another tool, then back to Move: the panel opens again to show it.
  await page.locator('[aria-label="Everything in your map"] button.list-item').first().click()
  await page.getByRole('button', { name: 'Close panel' }).click()
  const panel = page.locator('aside.side.sheet')
  await expect(panel).not.toHaveClass(/\bopen\b/)
  for (const tool of ['Paint bucket', 'Select and move']) {
    await page.getByRole('button', { name: /tools/i }).first().click()
    await page.locator('.tools-sheet').getByRole('button', { name: tool, exact: true }).click()
  }
  await expect(panel).toHaveClass(/\bopen\b/)
})

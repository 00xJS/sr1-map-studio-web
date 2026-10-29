// Decoy dummies in the editor: the Build tab's Dummy piece places one (the stand-in figure here, with no game
// folder in the test browser), its panel changes the pose, and the map stays solid only in its body boxes.
// With E2E_SHOTS=<folder> it also saves screenshots.
import { expect, test, type Page } from '@playwright/test'

const shots = process.env.E2E_SHOTS
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }

test('places a dummy and changes its pose', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('sr1-tour-done', '1') } catch { /* none */ } })
  await page.goto('/')
  await page.getByRole('button', { name: /make your first map/i }).click()
  const dialog = page.getByRole('dialog', { name: /start a map|generate/i })
  await dialog.getByRole('button', { name: /create this map/i }).first().click()
  await page.waitForURL(/\/editor\//, { timeout: 90_000 })
  await expect(page.locator('.editor-bar')).toBeVisible({ timeout: 60_000 })
  const close = page.getByRole('button', { name: /^(skip|close|done)/i }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  const tips = page.getByRole('button', { name: /hide these tips/i })
  if (await tips.isVisible().catch(() => false)) await tips.click()

  await page.getByRole('tab', { name: /^Build/ }).click()
  await page.getByRole('button', { name: 'Dummy…' }).click()
  await expect(page.getByText(/0 of 12 in this map/)).toBeVisible()
  await page.getByLabel('Top').selectOption('purple')
  await shot(page, 'dummy-picker')
  await page.getByRole('button', { name: /place at the camera/i }).click()
  const row = page.locator('[aria-label="Everything in your map"] button.list-item', { hasText: 'Dummy (player, purple top)' })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/1 of 12 in this map/)).toBeVisible()

  // Its panel: the stand-in (no game folder here), and another pose built in place.
  const panel = page.getByRole('region', { name: 'Selected' })
  await expect(panel.getByText('Decoy dummy')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Build from my game' })).toBeVisible()
  await row.dblclick()
  await page.waitForTimeout(800)
  // Back a little, to see all of it.
  const view = (await page.locator('canvas').first().boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(150) }
  await page.waitForTimeout(500)
  await shot(page, 'dummy-standing')
  const before = await page.locator('canvas').first().screenshot()
  await panel.getByLabel('Pose').selectOption('crouch')
  await expect(panel.getByLabel('Pose')).toHaveValue('crouch', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await shot(page, 'dummy-crouching')
  // The view redrew it in the new pose.
  expect((await page.locator('canvas').first().screenshot()).equals(before)).toBe(false)

  const item = await page.evaluate(() => {
    const p = (window as unknown as { __sr1Editor?: { getState(): { project: { scene_items: Record<string, unknown>[] } } } }).__sr1Editor?.getState().project
    return p ? p.scene_items.find((it) => (it as { dummy?: unknown }).dummy) ?? null : null
  })
  if (item) {
    expect((item as { collision_materials: string[] }).collision_materials).toEqual(['dummy_body'])
    expect((item as { dummy: { pose: string; built: boolean } }).dummy).toMatchObject({ pose: 'crouch', built: false })
  }
  expect(errors).toEqual([])
})

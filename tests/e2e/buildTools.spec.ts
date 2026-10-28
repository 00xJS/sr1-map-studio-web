// The build tools in a real browser: plan view, mirror mode's live numbers, Line up on several objects, the Measure
// tool and saved views. With E2E_SHOTS=<folder> it also saves screenshots.
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
  const close = page.getByRole('button', { name: /^(skip|close|done)/i }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  const tips = page.getByRole('button', { name: /hide these tips/i })
  if (await tips.isVisible().catch(() => false)) await tips.click()
}

const cameraType = (page: Page) => page.evaluate(() => (window as any).__viewer.camera.type as string)

test('plan view, mirror mode, line up, measure and saved views', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('sr1-tour-done', '1') } catch { /* none */ } })
  await makeMap(page)
  const canvas = page.locator('.viewport canvas').first()

  // Plan view: the camera pad's button, then O back to 3D.
  expect(await cameraType(page)).toBe('PerspectiveCamera')
  await page.getByRole('button', { name: 'Plan view', exact: true }).click()
  expect(await cameraType(page)).toBe('OrthographicCamera')
  await expect(page.locator('.viewport-hint')).toContainText('Plan view')
  await expect(page.getByRole('button', { name: 'Circle left' })).toHaveCount(0)
  await shot(page, 'plan-view')
  // Looking straight down: the camera's view runs along -Y.
  const down = await page.evaluate(() => { const d = (window as any).__viewer.camera.getWorldDirection(new ((window as any).__viewer.camera.position.constructor)()); return d.y })
  expect(down).toBeLessThan(-0.999)

  // A saved view in plan, then back to 3D with O and to the saved view with Alt+1.
  await page.getByRole('button', { name: 'Saved views' }).click()
  await page.getByRole('menuitem', { name: '+ Save this view' }).click()
  await expect(page.getByRole('menuitem', { name: /View 1/ })).toBeVisible()
  await shot(page, 'saved-views')
  await page.getByRole('button', { name: 'Saved views' }).click()
  await canvas.click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('o')
  expect(await cameraType(page)).toBe('PerspectiveCamera')
  await page.keyboard.press('Alt+1')
  expect(await cameraType(page)).toBe('OrthographicCamera')
  await page.keyboard.press('o')

  // Mirror mode's live numbers in the Build tab.
  await page.getByRole('tab', { name: /^Build/ }).click()
  await page.getByRole('button', { name: /mirror mode/i }).click()
  await expect(page.getByTestId('mirror-numbers')).toContainText(/Twins: \d+ of \d+ objects/)
  await shot(page, 'mirror-mode')
  await page.getByRole('button', { name: /mirror mode is on/i }).click()

  // Everything picked: Line up, then one undo puts it back.
  await canvas.click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+a')
  await expect(page.getByText('Line up', { exact: true })).toBeVisible()
  await shot(page, 'line-up')
  const before = await page.evaluate(() => JSON.stringify((window as any).__editor.getState().project.scene_items.map((it: any) => it.position)))
  await page.getByRole('button', { name: 'Middles' }).first().click()
  const undo = await page.evaluate(() => (window as any).__editor.getState().past.at(-1)?.label)
  expect(undo).toBe('Line up along X')
  await page.keyboard.press('Control+z')
  const after = await page.evaluate(() => JSON.stringify((window as any).__editor.getState().project.scene_items.map((it: any) => it.position)))
  expect(after).toBe(before)
  await page.keyboard.press('Escape')

  // Measure: M, two clicks on the map.
  await canvas.click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('m')
  const text = page.getByTestId('measure-text')
  await expect(text).toHaveText('Click the first point.')
  const b = (await canvas.boundingBox())!
  await canvas.click({ position: { x: b.width * 0.45, y: b.height * 0.6 } })
  await expect(text).toHaveText('Now click the second point.')
  await canvas.click({ position: { x: b.width * 0.6, y: b.height * 0.65 } })
  await expect(text).toHaveText(/^\d+(\.\d)? m/)
  await shot(page, 'measure')
  await page.keyboard.press('Escape')

  expect(errors).toEqual([])
})

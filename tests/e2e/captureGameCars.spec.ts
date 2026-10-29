// Pictures of the view leave out what markers draw from the player's game: the real car at a Vehicle spawn
// (editor/vehicleModels.ts) is drawn in the editor but never in a thumbnail, a kept loading picture or a share
// preview (Viewer.capture). Reads a local install through the dev server; skipped without one.
import { expect, test } from '@playwright/test'

test.skip(!process.env.SR1_PACKFILES, 'needs SR1_PACKFILES (a local game install) on the dev server')

test('a Vehicle spawn’s game car is left out of pictures of the view', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('sr1-tour-done', '1') } catch { /* none */ } })
  await page.goto('/')
  await page.getByRole('button', { name: /make your first map/i }).click()
  const dialog = page.getByRole('dialog', { name: /start a map|generate/i })
  await dialog.getByRole('button', { name: /create this map/i }).first().click()
  await page.waitForURL(/\/editor\//, { timeout: 90_000 })
  await expect(page.locator('.editor-bar')).toBeVisible({ timeout: 60_000 })

  // The dev server may reload the page once while it bundles what the game files need: try again after it.
  const check = () => page.evaluate(async () => {
    type Obj = { name: string; children: Obj[]; frustumCulled?: boolean; onBeforeRender?: () => void; getObjectByName(n: string): Obj | undefined; traverse(f: (o: Obj) => void): void }
    await (window as unknown as { __sr1GameObjects: { useDevServer(): Promise<unknown> } }).__sr1GameObjects.useDevServer()
    const [{ useEditor }, { getViewer }, { newMarker }, { catalogs }] = await Promise.all([
      import('/src/editor/store.ts' as string), import('/src/editor/Viewport.tsx' as string), import('/src/lib/project.ts' as string), import('/src/lib/catalogs.ts' as string),
    ])
    const v = getViewer()
    const at = v.center()
    const ids: string[] = catalogs.vehicles.map(([, id]: [string, string]) => id)
    let car: Obj | undefined
    for (const id of ids.slice(0, 6)) {
      useEditor.getState().update('Add a car', (d: { markers: unknown[] }) => { d.markers.push({ ...newMarker('Vehicle spawn', at), vehicle: id }) })
      const root = (v as unknown as { markerRoot: Obj }).markerRoot
      for (let i = 0; i < 100 && !car; i++) {
        await new Promise((ok) => setTimeout(ok, 200))
        car = root.children[root.children.length - 1]?.getObjectByName('vehicle')
      }
      if (car) break
    }
    if (!car) return { car: false, inView: 0, inPicture: 0, pic: false }
    // An empty helper: pictures of the view hide the editor's helpers while they draw, so the car drawn while it is
    // hidden is the car drawn into a picture (the editor's own frames go on around it).
    const sentinel = new (car.constructor as new () => Obj & { visible: boolean })()
    ;(v as unknown as { addHelper(o: unknown): void }).addHelper(sentinel)
    let inView = 0, inPicture = 0
    car.traverse((o) => { o.frustumCulled = false; o.onBeforeRender = () => { if (sentinel.visible) inView++; else inPicture++ } })
    v.requestRender()
    await new Promise((ok) => setTimeout(ok, 500))
    const pic = await v.capture(320, 180)
    return { car: true, inView, inPicture, pic: !!pic }
  })
  let r: Awaited<ReturnType<typeof check>> | null = null
  for (let i = 0; i < 3 && !r; i++) {
    try { r = await check() } catch (e) {
      if (!/context was destroyed|navigation/i.test(String(e))) throw e
      await page.waitForLoadState('load')
      await expect(page.locator('.editor-bar')).toBeVisible({ timeout: 60_000 })
    }
  }
  if (!r) throw new Error('the page kept reloading')
  expect(r.car).toBe(true)
  expect(r.inView).toBeGreaterThan(0)
  expect(r.inPicture).toBe(0)
})

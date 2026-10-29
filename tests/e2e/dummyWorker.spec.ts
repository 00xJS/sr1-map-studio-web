// The dummy builder's worker in a real browser: bakes the player from a local install that the dev server hands
// out (scripts/devGameFiles.ts, SR1_PACKFILES), and the page keeps running while it does. Skipped without one.
import { expect, test } from '@playwright/test'

test.skip(!process.env.SR1_PACKFILES, 'needs SR1_PACKFILES (a local game install) on the dev server')

test('bakes a dummy off the page thread', async ({ page }) => {
  await page.goto('/')
  const r = await page.evaluate(async () => {
    const names = ['misc2.vpp_xbox2', 'morph_stream.vpp_xbox2', 'preload.vpp_xbox2', 'cmesh_stream.vpp_xbox2']
    const files = new Map<string, Blob>()
    for (const n of names) files.set(n, await (await fetch('/__sr1dev/packfiles/' + n)).blob())
    const { gameSource, bake } = await import('/src/lib/dummies/packs.ts' as string)
    // The longest the page went without running a timer while the bake ran.
    let last = performance.now(), worst = 0
    const tick = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now }, 16)
    const t0 = performance.now()
    const b = await bake(gameSource(files), { model: 'player', pose: 'aim', look: { top: 'purple' } })
    clearInterval(tick)
    return { ms: performance.now() - t0, worst, tris: b.triangles.length / 3, mats: b.materials.length, pngs: b.materials.filter((m: { png?: Blob }) => m.png instanceof Blob).length, height: b.height }
  })
  console.log(JSON.stringify(r))
  expect(r.tris).toBeGreaterThan(4000)
  expect(r.pngs).toBe(r.mats)
  expect(r.height).toBeGreaterThan(1.65)
  expect(r.worst).toBeLessThan(250)
})

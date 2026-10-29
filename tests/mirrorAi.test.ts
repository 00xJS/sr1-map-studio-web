/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor, withoutMirror } from '../src/editor/store'
import { aiMiddle, quiet, runAiActions } from '../src/editor/aiActions'
import { describeMap } from '../src/lib/aiChat'
import { newMarker, newProject } from '../src/lib/project'

// Only storing files is stood in for: the AI runner and the shape command are the real ones.
vi.mock('../src/lib/files', async (orig) => ({
  ...(await orig<typeof import('../src/lib/files')>()),
  storeFile: vi.fn(async (_b: Blob, name: string) => ({ vpath: 'files/' + name, ref: { hash: 'h-' + name, name, type: 'model/obj', size: 1, origin: 'user' } })),
}))
vi.mock('../src/lib/importers', async (orig) => ({
  ...(await orig<typeof import('../src/lib/importers')>()),
  importImage: vi.fn(async () => ({ vpath: 'files/tex.png', ref: { hash: 'h-tex', name: 'tex.png', type: 'image/png', size: 1, origin: 'user' } })),
}))
vi.mock('../src/lib/images', async (orig) => ({
  ...(await orig<typeof import('../src/lib/images')>()),
  pixelsToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))

const st = () => useEditor.getState()
afterEach(() => { st().set({ mirror: false }); st().close() })

describe('mirror mode and the AI', () => {
  it("the AI's own twins aren't twinned again", async () => {
    st().open(newProject('AI'))
    st().set({ mirror: true })
    const r = await runAiActions([{ do: 'add_marker', type: 'Weapon pickup', weapon: 'ak47', x: 8, z: 8, mirror: true } as never], 'Add')
    expect(r.done).toBe(2)
    expect(st().project!.markers.map((m) => [m.position[0], m.position[2]])).toEqual([[8, 8], [-8, -8]])
    // Mirror mode is back on for the user's own edits.
    st().update('Move', (d) => { d.markers[0].position = [9, d.markers[0].position[1], 8] })
    expect(st().project!.markers[1].position[0]).toBe(-9)
  })

  it("shapes the AI adds after an await (a model to store) get no extra twins, about mirror mode's middle", async () => {
    const p = newProject('AI shapes')
    // An off-centre map: the spawns' middle is (100, 40).
    p.markers = [newMarker('Red team spawn', [100, 0, 20]), newMarker('Blue team spawn', [100, 0, 60])]
    st().open(p)
    st().set({ mirror: true })
    const r = await runAiActions([{ do: 'add_shape', shape: 'box', x: 104, z: 30, mirror: true } as never], 'Add')
    expect(r.skipped).toEqual([])
    expect(st().project!.scene_items.map((it) => [it.position[0], it.position[2]])).toEqual([[104, 30], [96, 50]])
  })

  it("refuses an async command not made with command(): its edits would land after withoutMirror", async () => {
    const loose = async () => {}
    expect(() => quiet(loose, 'loose')()).toThrow(/not made with command\(\)/)
    // Inside withoutMirror or not, the refusal is the same.
    expect(() => withoutMirror(() => quiet(loose, 'loose')())).toThrow(/command\(\)/)
  })
})

describe('the middle the AI pairs about', () => {
  const offCentre = () => {
    const p = newProject('Off centre')
    p.markers = [newMarker('Red team spawn', [100, 0, 20]), newMarker('Blue team spawn', [100, 0, 60])]
    return p
  }

  it('is the origin with mirror mode off, as before and as its map description says', async () => {
    st().open(offCentre())
    await runAiActions([{ do: 'add_marker', type: 'Weapon pickup', weapon: 'ak47', x: 104, z: 30, mirror: true } as never], 'Add')
    expect(st().project!.markers.slice(2).map((m) => [m.position[0], m.position[2]])).toEqual([[104, 30], [-104, -30]])
    expect(describeMap(st().project!)).toMatch(/twin at \(-x, -z\)/)
  })

  it("is mirror mode's while it's on, for its mirror action and its map description too", async () => {
    st().open(offCentre())
    st().set({ mirror: true })
    withoutMirror(() => st().update('Add', (d) => { d.markers.push({ ...newMarker('Weapon pickup', [104, 0, 30]), weapon: 'ak47' }) }))
    await runAiActions([{ do: 'mirror', markers: [2] } as never], 'Mirror')
    expect(st().project!.markers.at(-1)!.position).toMatchObject([96, expect.any(Number), 50])
    expect(describeMap(st().project!, undefined, aiMiddle())).toMatch(/about their middle, here \(100, 40\)/)
  })
})

describe('command() bodies', () => {
  it('start any other command through e.quietly, so it stays unmirrored under the AI too', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
    walk('src/editor')
    const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
    const names = [...sources.values()].flatMap((s) => [...s.matchAll(/export const (\w+) = command\(/g)].map((m) => m[1]))
    expect(names.length).toBeGreaterThanOrEqual(10)
    const bad: string[] = []
    for (const [file, s] of sources) {
      for (const m of s.matchAll(/export const (\w+) = command\(async \([^)]*\)[^{]*\{/g)) {
        // The command's body, up to its matching brace.
        let i = m.index! + m[0].length, depth = 1
        while (depth && i < s.length) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++ }
        const body = s.slice(m.index! + m[0].length, i)
        for (const line of body.split('\n')) {
          for (const n of names) {
            if (n === m[1] || !new RegExp(`(^|[^\\w])${n}\\(`).test(line)) continue
            if (!new RegExp(`quietly\\(\\(\\) => (\\w+\\.)?${n}\\(`).test(line)) bad.push(`${file}: ${m[1]} calls ${n} without e.quietly: ${line.trim()}`)
          }
        }
      }
    }
    expect(bad).toEqual([])
  })
})

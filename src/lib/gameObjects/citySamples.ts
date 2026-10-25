// Made-up groups and modules for looking at the review page ("Check game pieces") before the Stilwater study
// (cityModules.ts, phase A) fills groups() and cityModules() in. They are put together here from models in the
// player's own library (a bench, a trash can and a lamp as a "bus stop"; a building with the pieces the game puts
// on it as a "block"), so their pictures can be drawn, but the arrangements are invented: the page shows them
// only in development, marked as samples. Ids start with "sample:".
import type { CityGroup, CityModule, ModulePart, PartLayer } from './cityModules'
import type { GameObjectEntry } from './indexer'
import { identify } from './identity'

/** The most used model the rules give this name (and role), if the library has one. */
function pick(entries: GameObjectEntry[], name: string, role = 'prop'): GameObjectEntry | undefined {
  let best: GameObjectEntry | undefined
  for (const e of entries) {
    const id = identify(e)
    if (id.name === name && id.role === role && (!best || e.seen > best.seen)) best = e
  }
  return best
}

const part = (e: GameObjectEntry | undefined, at: [number, number, number], yaw: number, layer: PartLayer = 'prop'): ModulePart[] => (e ? [{ id: e.id, at, yaw, layer }] : [])

/** Sample groups (made up from the player's library). */
export function sampleGroups(entries: GameObjectEntry[]): CityGroup[] {
  const bench = pick(entries, 'Bench'), can = pick(entries, 'Trash can'), lamp = pick(entries, 'Street lamp'), sign = pick(entries, 'Street sign')
  const dumpster = pick(entries, 'Dumpster'), box = pick(entries, 'Cardboard box'), pallet = pick(entries, 'Pallet'), bags = pick(entries, 'Trash bags')
  const barrel = pick(entries, 'Barrel'), crate = pick(entries, 'Crate')
  const out: CityGroup[] = [
    {
      id: 'sample:bus-stop', name: 'Sample: bus stop', kind: 'street', settings: ['downtown'], anchor: 'ground', size: [6, 2.5], seen: 0, examples: [],
      parts: [...part(bench, [0, 0, 0], 0), ...part(can, [2.2, 0, 0.2], 0), ...part(lamp, [-2.6, 0, -0.6], 0), ...part(sign, [2.8, 0, -0.8], 90)],
    },
    {
      id: 'sample:dumpster-corner', name: 'Sample: dumpster and boxes', kind: 'alley', settings: ['rundown', 'industrial'], anchor: 'wall', back: '-z', size: [5, 2.5], seen: 0, examples: [],
      parts: [...part(dumpster, [0, 0, 0], 0), ...part(box, [1.9, 0, 0.3], 20), ...part(box, [2.2, 0, -0.5], 75), ...part(pallet, [-1.9, 0, 0], 90), ...part(bags, [1.4, 0, 0.9], 0)],
    },
    {
      id: 'sample:crate-stack', name: 'Sample: crates and barrels', kind: 'cover', settings: ['industrial', 'docks'], anchor: 'ground', size: [4, 3], seen: 0, examples: [],
      parts: [...part(crate, [0, 0, 0], 0), ...part(crate, [1.3, 0, 0.1], 10), ...part(barrel, [-1.1, 0, 0.6], 0), ...part(barrel, [-1.2, 0, -0.5], 0), ...part(pallet, [0.6, 0, -1.4], 0)],
    },
  ]
  return out.filter((g) => g.parts.length >= 2)
}

/** Sample modules: the most used buildings that have a layout, each with the pieces the game puts on it. */
export function sampleModules(entries: GameObjectEntry[]): CityModule[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const buildings = entries.filter((e) => identify(e).role === 'building' && (e.layout?.length ?? 0) >= 6).sort((a, b) => b.seen - a.seen).slice(0, 3)
  return buildings.map((b, i): CityModule => {
    const id = identify(b)
    const parts: ModulePart[] = [{ id: b.id, at: [0, 0, 0], yaw: 0, layer: 'shell' }]
    for (const p of b.layout ?? []) {
      const e = byId.get(p.id)
      if (!e || identify(e).role === 'skip') continue
      // (Layout turns are radians; a module part's are degrees.)
      parts.push({ id: p.id, at: p.at, yaw: (p.yaw * 180) / Math.PI, layer: e.kitOf ? 'kit' : 'detail' })
    }
    const [x, z] = b.long === 'z' ? [b.size[1], b.size[0]] : [b.size[0], b.size[1]]
    const front = id.building?.front ?? '+z'
    return {
      id: 'sample:block-' + i, name: `Sample: ${id.name} with its pieces`, kind: 'block', district: id.building?.districts?.[0] ?? 'Stilwater', settings: id.settings,
      source: { pack: b.pack, chunk: b.chunk, rect: [-x / 2, -z / 2, x / 2, z / 2] }, size: [Math.round(x), Math.round(z)], floor: [0, 0],
      edges: (['+x', '-x', '+z', '-z'] as const).map((side) => ({ side, kind: side === front ? 'street' : 'wall', openings: side === front ? [{ at: 0, width: 2 }] : [] })),
      entrances: [[front === '+x' ? x / 2 : front === '-x' ? -x / 2 : 0, 0, front === '+z' ? z / 2 : front === '-z' ? -z / 2 : 0]],
      parts, levels: [{ height: b.size[2], reach: 'none' }], tris: parts.reduce((t, p) => t + (byId.get(p.id)?.tris ?? 0), 0),
    }
  })
}

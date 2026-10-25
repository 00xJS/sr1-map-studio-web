// Placement rules (src/lib/gameObjects/placement.ts, behind cityModules.ts placementOf), how the game stands each
// model (sits.ts, counted by the indexer), the player's corrections (labels.ts) and the made-up samples the review
// page shows before the Stilwater study is in (citySamples.ts). Small chunks built here and made-up entries only;
// the real library is checked in placementGame.test.ts.
import { describe, expect, it } from 'vitest'
import { readChunk } from '../src/lib/gameObjects/chunk'
import { indexChunk, mergeCandidates, type GameObjectEntry } from '../src/lib/gameObjects/indexer'
import { placementOf } from '../src/lib/gameObjects/cityModules'
import { placementRules, type Library } from '../src/lib/gameObjects/placement'
import { sitsFrom, SITS_LEN, type Sits } from '../src/lib/gameObjects/sits'
import { fixRule, withCityLabels, withPlacementLabels } from '../src/lib/gameObjects/labels'
import { sampleGroups, sampleModules } from '../src/lib/gameObjects/citySamples'
import { buildChunk, yawRot, type Spec, type VbSpec } from './chunkBuilder'

/** A closed box (all six sides), feet at y = 0, centred across: one strip per side, joined by degenerate pairs. */
function solid(sx: number, sy: number, sz: number): VbSpec {
  const x = sx / 2, z = sz / 2
  const faces = [
    [[-x, 0, -z], [x, 0, -z], [-x, sy, -z], [x, sy, -z]], [[-x, 0, z], [x, 0, z], [-x, sy, z], [x, sy, z]],
    [[-x, 0, -z], [-x, 0, z], [-x, sy, -z], [-x, sy, z]], [[x, 0, -z], [x, 0, z], [x, sy, -z], [x, sy, z]],
    [[-x, 0, -z], [x, 0, -z], [-x, 0, z], [x, 0, z]], [[-x, sy, -z], [x, sy, -z], [-x, sy, z], [x, sy, z]],
  ]
  const verts: number[][] = [], indices: number[] = []
  faces.forEach((f, i) => {
    const b = verts.length
    f.forEach((v) => verts.push([...v, 0, 0]))
    if (i) indices.push(indices[indices.length - 1], b)
    indices.push(b, b + 1, b + 2, b + 3)
  })
  return { verts, indices }
}

/**
 * A street corner: the ground; a three-part building (10 x 6 x 10 m); two shop signs flush on its walls at 3 m
 * (one turned to face +x); a crate on the ground; an AC unit on the roof; a canopy with a lamp hanging under it.
 */
const corner = (): Spec => {
  const parts = [solid(80, 0.1, 80), solid(10, 6, 4), solid(10, 6, 2), solid(2, 1, 0.1), solid(1, 1, 1), solid(1.5, 1, 1), solid(4, 0.2, 4), solid(0.4, 0.5, 0.4)]
  return {
    strings: ['ter_grass_co.tga', 'b11_wall_co.tga', 'shopsign_tm.tga', 'crate_wo.tga', 'acunit_me.tga', 'canopy_me.tga', 'lamp_me.tga'],
    vbs: parts,
    materials: [[0], [1], [2], [3], [4], [5], [6]],
    meshes: parts.map((_, v) => ({ subs: [{ vb: v, batches: [[0, parts[v].indices.length, [0, 1, 1, 2, 3, 4, 5, 6][v]]] }] })),
    instances: [
      { pos: [0, -0.1, 0], mesh: 0 },
      { pos: [0, 0, -3], mesh: 1 }, { pos: [0, 0, 0], mesh: 2 }, { pos: [0, 0, 3], mesh: 1 },
      { pos: [0, 3, 5.05], mesh: 3 }, { pos: [5.05, 3, 0], rot: yawRot(90), mesh: 3 },
      { pos: [20, 0, 20], mesh: 4 },
      { pos: [0, 6, 0], mesh: 5 },
      { pos: [20, 4, 0], mesh: 6 }, { pos: [20, 3.4, 0], mesh: 7 },
    ],
    records: [
      { name: 'ter_ground01', instance: 0 },
      { name: 'abcd1a_walla', instance: 1 }, { name: 'abcd1a_wallb', instance: 2 }, { name: 'abcd1a_wallc', instance: 3 },
      { name: 'shopsigna01', instance: 4 }, { name: 'shopsigna02', instance: 5 },
      { name: 'crate01', instance: 6, profile: 'Crate' },
      { name: 'acunita01', instance: 7 },
      { name: 'canopya01', instance: 8 }, { name: 'hanglampa01', instance: 9 },
    ],
  }
}

const entry = (p: Partial<GameObjectEntry>): GameObjectEntry => ({
  id: 'x', name: 'thing', cat: 'Other', profile: '', pack: 'sr_city_stream', chunk: 'c1', record: 0, size: [1, 1, 1], tris: 12, tex: [], seen: 4, ...p,
})

/** Made-up counts: placements on the ground, on a wall (and which side backs onto it), on a roof, hanging. */
function sits(p: Partial<Record<'ground' | 'wall' | 'roof' | 'hang' | 'ceiling' | 'inside' | 'lift', number>> & { back?: number[]; open?: number[] }): Sits {
  const n = (p.ground ?? 0) + (p.wall ?? 0) + (p.roof ?? 0) + (p.hang ?? 0)
  const sums = new Array(SITS_LEN).fill(0)
  sums[0] = n; sums[1] = p.ground ?? 0; sums[2] = p.wall ?? 0; sums[3] = p.roof ?? 0; sums[4] = p.hang ?? 0; sums[5] = p.inside ?? 0
  ;(p.back ?? [0, 0, 0, 0]).forEach((v, i) => (sums[6 + i] = v))
  sums[10] = (p.lift ?? 0) * n
  ;(p.open ?? [3, 3, 3, 3]).forEach((v, i) => (sums[11 + i] = v * n))
  sums[15] = p.ceiling ?? 0
  return sitsFrom(sums, 1)
}

describe('how the game stands each model', () => {
  const lib = mergeCandidates(indexChunk(readChunk(buildChunk(corner())), 'sr_city_stream', 'sr_chunk01'))
  const by = (n: string) => lib.find((e) => e.name === n)!

  it('sees signs flush on walls, crates on the ground, units on roofs and lamps hanging under a ceiling', () => {
    const sign = by('shopsigna'), crate = by('crate'), ac = by('acunita'), lamp = by('hanglampa')
    expect(sign.sits).toMatchObject({ n: 2, wall: 2 })
    // Both signs have the wall behind their own -z side (one is turned 90°: the frame turns with it).
    expect(sign.sits!.back).toEqual([0, 0, 0, 2])
    expect(sign.sits!.lift).toBeCloseTo(3, 1)
    expect(crate.sits).toMatchObject({ n: 1, ground: 1, wall: 0 })
    expect(crate.sits!.cover).toBe(1)
    expect(ac.sits).toMatchObject({ roof: 1, inside: 1 })
    expect(lamp.sits).toMatchObject({ hang: 1, ceiling: 1 })
  })

  it('makes them into rules', () => {
    const rules = placementRules(lib)
    // The signs only ever stand on this one kind of building: they are its own (kept on it, facing out).
    const building = lib.find((e) => e.cat === 'Buildings')!
    expect(rules.get(by('shopsigna').id)).toMatchObject({ attach: 'building', facing: '+z', onlyOn: [building.id], mayVary: [] })
    expect(rules.get(by('crate').id)).toMatchObject({ attach: 'ground', coverHeight: 1, seeThrough: false })
    expect(rules.get(by('crate').id)!.mayVary).toContain('turn')
    expect(rules.get(by('acunita').id)).toMatchObject({ attach: 'roof', reach: 'ladder' })
    expect(rules.get(by('hanglampa').id)).toMatchObject({ attach: 'hang' })
    // Hanging and wall things say how high the game has them.
    expect(rules.get(by('hanglampa').id)!.mountHeight).toBeCloseTo(3.4, 1)
    expect(rules.get(by('crate').id)!.mountHeight).toBeUndefined()
    // The building itself stands on the ground; a road is ground.
    expect(placementOf(building)).toMatchObject({ attach: 'ground' })
    expect(placementOf(entry({ name: 'ter_road01', tex: ['Ter_Street01_co.tga'], size: [24, 24, 0.4] })).attach).toBe('ground')
  })
})

describe('placement rules', () => {
  it('keeps a building\'s own pieces on it, but not a barrel that happens to stand only on its roof', () => {
    const window = entry({ id: 'w', name: 'abcd1a_window', tex: ['b11_window_gl.tga'], size: [1.2, 0.1, 1.6], record: -3, kitOf: 'abcd1a', belongsTo: ['b1', 'b2'], sits: sits({ wall: 4, back: [0, 0, 0, 4] }) })
    expect(placementOf(window)).toMatchObject({ attach: 'building', onlyOn: ['b1', 'b2'], facing: '+z', mayVary: [] })
    const barrel = entry({ id: 'b', name: 'barrelc', tex: ['barrel_rust_me.tga'], size: [0.8, 0.75, 1.05], kitOf: 'abcd1a', belongsTo: ['b1'], sits: sits({ roof: 3, lift: 8, inside: 3 }) })
    const r = placementOf(barrel)
    expect(r.attach).toBe('roof')
    expect(r.onlyOn).toBeUndefined()
  })

  it('never places a lamp without its base, nor the base without the lamp, and the base goes where the lamp goes', () => {
    const lamp = entry({ id: 'lamp', name: 'lamppoststa', tex: ['highway-light.tga'], size: [3.9, 0.5, 13.5], seen: 10, assembly: [{ id: 'base', at: [0, -0.5, 0], yaw: 0, share: 1 }], sits: sits({ ground: 9, hang: 1 }) })
    const base = entry({ id: 'base', name: 'lamppostbsea', tex: ['conc_co.tga'], size: [0.8, 0.8, 0.5], seen: 10, partOf: 'lamp', sits: sits({ hang: 5, lift: 0.4 }) })
    const lib: Library = new Map([[lamp.id, lamp], [base.id, base]])
    expect(placementOf(lamp, lib)).toMatchObject({ attach: 'ground', needs: ['base'] })
    expect(placementOf(base, lib)).toMatchObject({ attach: 'ground', needs: ['lamp'], mayVary: [] })
    // A part the whole only sometimes has with it can be placed alone.
    const often = entry({ ...base, id: 'base2', seen: 40 })
    const lib2: Library = new Map([[lamp.id, { ...lamp, assembly: [{ id: 'base2', at: [0, -0.5, 0], yaw: 0, share: 1 }] }], [often.id, often]])
    expect(placementOf(often, lib2).needs).toBeUndefined()
  })

  it('goes by the name and shape when the game\'s placements say nothing', () => {
    expect(placementOf(entry({ name: 'ceilinglight_a', size: [2, 1.4, 0.3] })).attach).toBe('hang')
    expect(placementOf(entry({ name: 'postera', tex: ['poster_tm.tga'], size: [1, 0.02, 1.5] })).attach).toBe('wall')
    expect(placementOf(entry({ name: 'crate', size: [1, 1, 1] })).attach).toBe('ground')
  })

  it('keeps big structures and tall things off roofs and out of the air', () => {
    // A highway deck held by its ends: nothing under its middle, but it isn't hanging.
    expect(placementOf(entry({ name: 'hwy_c', size: [45, 18, 7], sits: sits({ hang: 4, lift: 20 }) })).attach).toBe('ground')
    expect(placementOf(entry({ name: 'postcement_co', size: [68, 8.5, 7.3], sits: sits({ roof: 4, ground: 1, lift: 9 }) })).attach).toBe('ground')
    // Wires strung between poles hang.
    expect(placementOf(entry({ name: 'utilitypolewireaa', size: [40, 4, 1], sits: sits({ hang: 2, lift: 15 }) })).attach).toBe('hang')
  })

  it('says what needs floor in front, how it is reached and what may change', () => {
    const door = placementOf(entry({ name: 'door_a', tex: ['door_wo.tga'], size: [1.2, 0.1, 2.4], sits: sits({ wall: 4, back: [0, 0, 4, 0], open: [3, 3, 0, 1.6] }) }))
    expect(door).toMatchObject({ attach: 'wall', facing: '-z', clearFront: 1.6 })
    const shelf = placementOf(entry({ name: 'shelf_d', size: [1.6, 0.5, 1.8], sits: sits({ ground: 5, back: [0, 0, 0, 5] }) }))
    // Kept with its back to a wall: it faces out and isn't turned, but may slide along.
    expect(shelf).toMatchObject({ attach: 'ground', facing: '+z' })
    expect(shelf.mayVary).not.toContain('turn')
    expect(shelf.mayVary).toContain('nudge')
    const crateUpstairs = placementOf(entry({ name: 'crate', size: [1, 1, 1], sits: sits({ ground: 4, lift: 7, inside: 4 }) }))
    expect(crateUpstairs.reach).toBe('stairs')
    const bush = placementOf(entry({ name: 'bushb', tex: ['bush_leaf.tga'], size: [1.5, 1.2, 1.4], sits: sits({ ground: 4 }) }))
    expect(bush.mayVary).toEqual(expect.arrayContaining(['turn', 'nudge', 'mirror', 'variant']))
    const sign = placementOf(entry({ name: 'shopsign', size: [2, 0.1, 1], sits: sits({ ground: 4 }) }))
    expect(sign.mayVary).not.toContain('mirror')
    const fence = placementOf(entry({ name: 'fencechaina', tex: ['Galv_Met.tga', 'cc_chainlinkA_fm.tga'], size: [4.2, 0.12, 2.4], sits: sits({ ground: 4 }) }))
    expect(fence).toMatchObject({ coverHeight: 2.4, seeThrough: true })
  })
})

describe('the player\'s corrections', () => {
  const sign = entry({ id: 's', name: 'shopsign', size: [2, 0.1, 1], kitOf: 'abcd1a', belongsTo: ['b1'], sits: sits({ wall: 4, back: [0, 0, 0, 4] }) })

  it('override the rules field by field; empty lists and nulls clear them', () => {
    const base = placementOf(sign)
    expect(fixRule(base, { attach: 'wall', facing: null, onlyOn: [] })).toEqual({ ...base, attach: 'wall', facing: undefined, onlyOn: undefined })
    const rule = withPlacementLabels({ s: { place: { attach: 'ground', mayVary: ['turn'], clearFront: 1 } } })(sign)
    expect(rule).toMatchObject({ attach: 'ground', mayVary: ['turn'], clearFront: 1, onlyOn: ['b1'] })
    // A model marked right keeps the rules' answer.
    expect(withPlacementLabels({ s: { place: { ok: true } } })(sign)).toEqual(base)
  })

  it('leave out the groups and modules marked wrong and rename the others', () => {
    const groups = [{ id: 'a', name: 'Bus stop', kind: 'street', settings: [] }, { id: 'b', name: 'Thing', kind: 'other', settings: [] }]
    expect(withCityLabels(groups, { b: { drop: true }, a: { name: 'Shelter', settings: ['downtown'] } })).toEqual([{ id: 'a', name: 'Shelter', kind: 'street', settings: ['downtown'] }])
  })
})

describe('sample groups and modules', () => {
  it('are put together from the library, in the agreed shapes', () => {
    const lib: GameObjectEntry[] = [
      entry({ id: 'bench', name: 'benchparka', profile: 'Park Bench', size: [2, 0.7, 0.9], seen: 9 }),
      entry({ id: 'can', name: 'trashcana', profile: 'Trashcan_Anchored', size: [0.7, 0.7, 1.1], seen: 7 }),
      entry({ id: 'crate', name: 'cratea', tex: ['crate_wo.tga'], size: [1, 1, 1], seen: 5 }),
      entry({ id: 'barrel', name: 'barrelc', tex: ['barrel_rust_me.tga'], size: [0.8, 0.75, 1.05], seen: 5 }),
      entry({ id: 'bld', name: 'abcd1a', cat: 'Buildings', parts: [1, 2, 3], size: [12, 9, 14], seen: 3, front: '+z', layout: Array.from({ length: 6 }, (_, i) => ({ id: 'win' + i, at: [i, 3, 4.5] as [number, number, number], yaw: Math.PI / 2, share: 1 })) }),
      ...Array.from({ length: 6 }, (_, i) => entry({ id: 'win' + i, name: 'abcd1a_win' + 'abcdef'[i], tex: ['b11_window_gl.tga'], size: [1.2, 0.1, 1.6], kitOf: 'abcd1a' })),
    ]
    const g = sampleGroups(lib)
    expect(g.map((x) => x.id)).toEqual(['sample:bus-stop', 'sample:crate-stack'])
    expect(g[0].parts.map((p) => p.id)).toEqual(['bench', 'can'])
    const m = sampleModules(lib)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ kind: 'block', size: [12, 9] })
    expect(m[0].parts.slice(0, 2)).toMatchObject([{ id: 'bld', layer: 'shell' }, { id: 'win0', layer: 'kit', yaw: 90 }])
    expect(m[0].edges.find((ed) => ed.side === '+z')).toMatchObject({ kind: 'street' })
  })
})

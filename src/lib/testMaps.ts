// Test maps for the in-game test sprint (see /proven): one small map per batch, built as a normal project in this
// browser, with a "what to look for" checklist made from the features' notes in featureStatus.ts. Batch 1 is what
// every export ships by default, batch 2 dry interiors, batch 3 the features a mapper turns on.
// Physics props and breakables go through the same Python step as the editor's buttons, so the saved map already
// has them; everything else is plain sample-map parts and markers (lib/samples.ts).
import { FEATURES, type FeatureId } from './featureStatus'
import { buildFrom, materialize } from './samples'
import { GB, PB, box, ground, perimeter, ramp, type MarkerSpec, type Part, type Sample, type Tex } from './sampleKit'
import { PHYSICS_PREFABS, ballObj, oneMaterial, type PhysicsPart, type PhysicsTag } from './prefabsPhysics'
import { PRESET_BY_KEY } from './physicsProps'
import { CRATE_PROFILE, loadingMode } from './mapFeatures'
import { BOR, BOR_CAR_BLUE, BOR_CAR_RED, BOR_CASH, BOR_CHOP, BOR_DOOR, BOR_ENTRANCE, BOR_GARAGE_BLUE, BOR_GARAGE_RED, BOR_VICTORY, SOUND_ZONE, borMissing } from './retailModes'
import { ITEM_PROP } from './gameObjects/items'
import { dryInteriors, gameSkyWanted, isGlass, isProp, type FileRef, type Project, type ProjectSettings, type SceneItem, type Vec3 } from './project'
import { shapeObj } from './shapes'
import { storeFile } from './files'

export type BatchId = 1 | 2 | 3

/** A part the build turns into a physics prop (a preset) or a breakable (glass or wood, optionally the smashing crate). */
export type NativeTag = PhysicsTag | { breakable: 'glass' | 'wood'; profile?: string }
type TestPart = Part & { native?: NativeTag }

export interface TestBatch {
  id: BatchId
  title: string
  /** One line under the title. */
  blurb: string
  /** What a tester checks on this map, in order. */
  features: FeatureId[]
  /** Where each feature is in the map, or how to bring it out. */
  where: Partial<Record<FeatureId, string>>
  /** Features of the batch the map leaves out, and why. */
  absent?: Partial<Record<FeatureId, string>>
  /** Steps before the checks: install, which mode to start. */
  setup: string[]
  sample: () => Omit<Sample, 'parts'> & { parts: TestPart[] }
  settings: Partial<ProjectSettings>
}

const T = {
  floor: { gen: 'concrete', tweak: { seed: 5 } } as Tex,
  wall: { gen: 'concrete', tweak: { color: '#6f6d69', seed: 4, wear: 0.6 } } as Tex,
  roof: { gen: 'metal_plate' } as Tex,
  brick: { gen: 'brick' } as Tex,
  water: { gen: 'water' } as Tex,
  glass: { gen: 'paint', tweak: { color: '#9cc9e0', accent: '#5d8aa3', seed: 381 }, surface: 8 } as Tex,
  wood: { gen: 'wood_planks', tweak: { seed: 382 } } as Tex,
}

/** n spawns on a ring, the first at angle `start` (degrees), each facing the middle. */
const ring = (type: string, n: number, r: number, start = 0, y = 1): MarkerSpec[] => Array.from({ length: n }, (_, i) => {
  const a = ((start + (i * 360) / n) * Math.PI) / 180
  return [type, [+(Math.sin(a) * r).toFixed(2), y, +(-Math.cos(a) * r).toFixed(2)], { yaw: +((start + (i * 360) / n + 180) % 360).toFixed(1) }]
})
/** A spawn at x, z facing the middle of the map. */
const facing = (type: string, x: number, z: number): MarkerSpec => [type, [x, 1, z], { yaw: +((Math.atan2(-x, z) * 180) / Math.PI + 360).toFixed(1) % 360 }]
const weapon = (id: string, at: Vec3): MarkerSpec => ['Weapon pickup', at, { weapon: id }]
const native = (part: Part, tag: NativeTag): TestPart => ({ ...part, native: tag })
/** A physics showcase set (prefabsPhysics.ts) at x, z: its props become physics props, its other parts stay put. */
const physicsSet = (key: keyof typeof PHYSICS_PREFABS, x: number, z: number, rot = 0): TestPart[] =>
  (PHYSICS_PREFABS[key].make(x, z, rot, 1) as PhysicsPart[]).map(({ physics, ...p }) => (physics ? native(p, physics) : p))

export const TEST_BATCHES: TestBatch[] = [
  {
    id: 1,
    title: 'Batch 1: what every export ships',
    blurb: 'A walled yard, open to the sky, with nothing turned on or off: the map as everyone gets it by default.',
    features: ['game_sky', 'loading_screen', 'logo_walls'],
    where: {
      game_sky: 'Look up from anywhere in the yard. Try a few matches to catch day and night.',
      loading_screen: 'Watch the screen between choosing the map and spawning.',
      logo_walls: 'Walk along all four outer walls, inside the yard.',
    },
    setup: ['Install it in game with your game folder connected (the sky comes from your game files).', 'Start Gangsta Brawl on it.'],
    settings: {},
    sample: () => ({
      id: 'testdefaults', name: 'Test 1 Defaults', icon: '🧪', theme: 'Starter', modes: GB,
      description: 'In-game test map: the game sky, the loading screen and the logo walls.',
      parts: [
        ground(64, 64, T.floor), ...perimeter(64, 64, 8, T.wall),
        ...([[-12, -12], [12, 12], [12, -12], [-12, 12]] as const).map(([x, z]) => box('Cover', [4, 3, 4], [x, 1, z], PB.plywood, PB.plywood)),
        box('Tower', [6, 6, 6], [0, 1, 0], T.wall, T.brick),
        ramp('Ramp', [4, 6, 10], [0, 1, 8], PB.plywood, T.wall),
      ],
      markers: [...ring('Shared spawn', 8, 24, 22.5), weapon('ak47', [-18, 1, 0]), weapon('ak47', [18, 1, 0]), weapon('pump_action_shotgun', [0, 1, -18]), weapon('sniper_rifle', [0, 7, 0])],
      lights: [[[0, 12, 0]]],
    }),
  },
  {
    id: 2,
    title: 'Batch 2: dry interiors',
    blurb: 'A yard with one roofed room and the weather changing each match, so it rains outside and should not inside.',
    features: ['random_weather', 'dry_interiors'],
    where: {
      random_weather: 'Start a few matches in a row: each rolls the time of day and the weather.',
      dry_interiors: 'In a rainy match, walk into the roofed room through its doorway and look at the floor and the doorway.',
    },
    setup: ['Install it in game.', 'Start Gangsta Brawl; restart until a match rolls rain.'],
    settings: { always_clear_weather: false },
    sample: () => ({
      id: 'testdry', name: 'Test 2 Dry Interiors', icon: '🧪', theme: 'Starter', modes: GB,
      description: 'In-game test map: rain outside, none in the roofed room.',
      parts: [
        ground(80, 80, T.floor), ...perimeter(80, 80, 8, T.wall),
        // The room: 20 × 20, a doorway in its south wall, a roof on top.
        box('Room wall', [22, 8, 1], [-18, 1, -10.5], T.wall, T.brick),
        box('Room wall', [1, 8, 20], [-28.5, 1, 0], T.wall, T.brick),
        box('Room wall', [1, 8, 20], [-7.5, 1, 0], T.wall, T.brick),
        box('Room wall', [8, 8, 1], [-25, 1, 10.5], T.wall, T.brick),
        box('Room wall', [8, 8, 1], [-11, 1, 10.5], T.wall, T.brick),
        box('Roof', [24, 1, 24], [-18, 9, 0], T.roof, T.wall),
        ...([[12, -8], [14, 12], [0, 18]] as const).map(([x, z]) => box('Cover', [4, 3, 4], [x, 1, z], PB.plywood, PB.plywood)),
      ],
      markers: [
        ['Shared spawn', [-18, 1, -2], { yaw: 180 }],
        // Round the yard, none behind the room.
        ...([[0, -32], [24, -24], [32, 0], [24, 24], [0, 32], [-24, 28], [-30, -26]] as const).map(([x, z]) => facing('Shared spawn', x, z)),
        weapon('ak47', [-25, 1, 7]), weapon('pump_action_shotgun', [20, 1, 0]), weapon('tec9', [0, 1, -14]),
      ],
      lights: [[[-18, 8, 0]], [[18, 12, 0]]],
    }),
  },
  {
    id: 3,
    title: 'Batch 3: features you turn on',
    blurb: 'One bigger yard holding every opt-in feature: a pool, physics props, breakables, Blinged Out Ride and more.',
    features: ['water', 'physics_props', 'breakable_glass', 'breakable_wood', 'crate_debris', 'blinged_out_ride', 'item_props', 'sound_zones', 'surface_registration', 'pimp_exit'],
    where: {
      water: 'The walled pool in the south-east corner: walk up the ramp and jump in.',
      physics_props: 'The crate tower (south-west), the tire ramp (south) and the propane tanks (west): shoot, kick and blast them.',
      breakable_glass: 'The blue pane north-east of the middle.',
      breakable_wood: 'The plank box beside the pane.',
      crate_debris: 'The crate beside the plank box: blow it up or drive into it.',
      blinged_out_ride: "Start Blinged Out Ride: the red team's car and garage at the south end, the blue team's at the north end, the chop shop shed in the east, the victory garage in the north-west.",
      item_props: 'The item prop marker just south-east of the middle (it shows only if an item is chosen on it).',
      sound_zones: 'Stand by the pool: the sound zone is round it (it plays only if a sound is chosen on it).',
      surface_registration: 'Walk and shoot on the concrete floor, the wooden ramp and the metal pool walls: footsteps and impacts should match each.',
    },
    absent: {
      pimp_exit: 'Not in this map: the export refuses a pimp exit marker, because the game has no pimp exit action. Nothing to try in game.',
    },
    setup: [
      'Before installing, check the item prop and sound zone markers have an item and a sound (the names come from your game files).',
      'Install it in game. Start Gangsta Brawl for the props, the pool and the sounds, then Blinged Out Ride.',
    ],
    settings: { surface_preload: true },
    sample: () => ({
      id: 'testoptin', name: 'Test 3 Opt-ins', icon: '🧪', theme: 'Starter', modes: [...GB, BOR],
      description: 'In-game test map: water, physics props, breakables, Blinged Out Ride, item props, sound zones and surface registration.',
      parts: [
        ground(160, 160, T.floor), ...perimeter(160, 160, 10, T.wall),
        // The pool: a walled basin 18 × 18 inside, water 2.5 m deep, its rim 0.5 m above the water; a ramp up the west side.
        box('Pool wall', [20, 6, 1], [50, 1, -59.5], PB.steel, PB.steel), box('Pool wall', [20, 6, 1], [50, 1, -40.5], PB.steel, PB.steel),
        box('Pool wall', [1, 6, 18], [40.5, 1, -50], PB.steel, PB.steel), box('Pool wall', [1, 6, 18], [59.5, 1, -50], PB.steel, PB.steel),
        { ...box('Pool water', [18, 5, 18], [50, 1, -50], T.water, T.water), water: true },
        ramp('Pool ramp', [6, 6, 10], [35, 1, -50], T.wood, T.wall, -90),
        ...physicsSet('crate_tower', -50, -50),
        ...physicsSet('tire_ramp', 0, -45),
        ...physicsSet('propane_chain', -60, 30),
        native(box('Glass pane', [4, 3, 0.25], [16, 1, 16], T.glass, T.glass), { breakable: 'glass' }),
        native(box('Plank box', [2, 2, 2], [22, 1, 16], T.wood, T.wood), { breakable: 'wood' }),
        native(box('Crate', [2, 2, 2], [26, 1, 16], PB.planks, PB.planks), { breakable: 'wood', profile: CRATE_PROFILE }),
        // Blinged Out Ride: a chop shop shed in the east, open on its west side to drive in.
        box('Shed wall', [1, 8, 24], [74.5, 1, 30], T.wall, T.brick),
        box('Shed wall', [17, 8, 1], [66, 1, 18.5], T.wall, T.brick), box('Shed wall', [17, 8, 1], [66, 1, 41.5], T.wall, T.brick),
        box('Shed roof', [18, 1, 25], [66, 9, 30], T.roof, T.wall),
      ],
      markers: [
        ...ring('Shared spawn', 8, 46, 22.5),
        ...([-12, -4, 4, 12] as const).flatMap((x): MarkerSpec[] => [['Red team spawn', [x, 1, -70], { yaw: 180 }], ['Blue team spawn', [x, 1, 70], { yaw: 0 }]]),
        [BOR_CAR_RED, [-24, 1, -66], { yaw: 180 }], [BOR_GARAGE_RED, [-24, 1, -66]],
        [BOR_CAR_BLUE, [24, 1, 66], { yaw: 0 }], [BOR_GARAGE_BLUE, [24, 1, 66]],
        [BOR_CHOP, [66, 1, 30]], [BOR_ENTRANCE, [46, 1, 30]], [BOR_DOOR, [57, 1, 44]],
        [BOR_VICTORY, [-62, 1, 62]],
        ['Chains drop-off', [0, 1, 20]],
        ...ring(BOR_CASH, 8, 30, 0),
        [ITEM_PROP, [8, 1, -8]],
        [SOUND_ZONE, [50, 1, -50], { radius: 10 }],
        weapon('ak47', [-36, 1, 8]), weapon('ak47', [36, 1, -8]), weapon('rpg_launcher', [0, 1, 0]), weapon('pipe_bomb', [-30, 1, 30]),
      ],
      lights: [[[0, 14, 0]], [[50, 12, -50]], [[-50, 12, -50]]],
    }),
  },
]

export const testBatch = (id: BatchId): TestBatch => TEST_BATCHES.find((b) => b.id === id)!

/** The features no test map holds, so a tester knows they are not covered yet. */
export const UNBATCHED: FeatureId[] = (Object.keys(FEATURES) as FeatureId[]).filter((id) => !TEST_BATCHES.some((b) => b.features.includes(id)))

export interface ChecklistLine { id: FeatureId; label: string; where: string; look: string }

/** What a note says to look for (its "Look for:" part), else the whole note. */
export const lookFor = (note: string) => note.match(/Look for:\s*(.+)$/)?.[1] ?? note

/** The printable checklist: one line per feature, where it is in the map and what to look for. */
export function testChecklist(batch: TestBatch): ChecklistLine[] {
  return batch.features.map((id) => ({
    id, label: FEATURES[id].label,
    where: batch.absent?.[id] ?? batch.where[id] ?? '',
    look: batch.absent?.[id] ? '' : lookFor(FEATURES[id].note),
  }))
}

/** Whether a built map carries a feature (for the tests, and as a guard that a test map still tests what it says). */
export function carries(p: Project, id: FeatureId): boolean {
  const s = p.settings, items = p.scene_items, has = (type: string) => p.markers.some((m) => m.type === type)
  // Physics props are wood natives too (Python's native_prop): a breakable is one that isn't a prop.
  const breakables = items.filter((it) => it.native_breakable_kind && !isProp(it))
  switch (id) {
    case 'game_sky': return gameSkyWanted(s)
    case 'loading_screen': return loadingMode(p) === 'auto'
    case 'logo_walls': return items.some((it) => Object.values(it.textures).some((t) => t.endsWith('/saints_reborn_wall.jpg')))
    case 'random_weather': return !s.always_clear_weather
    case 'dry_interiors': return dryInteriors(s) && items.some((it) => it.name.startsWith('Roof'))
    case 'water': return items.some((it) => it.swimmable_water)
    case 'physics_props': return items.some((it) => !!it.physics_preset)
    case 'breakable_glass': return breakables.some((it) => it.native_breakable_kind === 'glass')
    case 'breakable_wood': return breakables.some((it) => it.native_breakable_kind === 'wood' && it.native_profile !== CRATE_PROFILE)
    case 'crate_debris': return breakables.some((it) => it.native_breakable_kind === 'wood' && it.native_profile === CRATE_PROFILE)
    case 'blinged_out_ride': return s.modes.includes(BOR) && !borMissing(p.markers).length
    case 'item_props': return has(ITEM_PROP)
    case 'sound_zones': return has(SOUND_ZONE)
    case 'surface_registration': return !!s.surface_preload
    default: return false
  }
}

/** Turns placed parts into natives, as the editor's buttons do (Python: native_prop, convert_breakable). */
export type NativeConverter = (p: Project, jobs: { index: number; tag: NativeTag }[]) => Promise<void>

export interface BuildOptions {
  onProgress?: (t: string) => void
  /** Defaults to the editor's own Python step. */
  convert?: NativeConverter
  /** An item and a sound from the player's game for batch 3's markers (default: read if the game folder is already connected). */
  gameNames?: () => Promise<{ item?: string; sound?: string }>
}

/** Builds a batch's test map as a new project (not saved; the caller saves it). */
export async function buildTestMap(id: BatchId, opts: BuildOptions = {}): Promise<Project> {
  const batch = testBatch(id)
  const sample = batch.sample()
  const plain = sample.parts.filter((x) => !x.native), natives = sample.parts.filter((x) => x.native)
  const p = await buildFrom({ ...sample, parts: plain }, opts.onProgress)
  p.description = sample.description
  Object.assign(p.settings, batch.settings)
  // Map file names: 10 characters at most with early surface registration.
  p.settings.base_name = `test${id}` + Math.floor(1000 + Math.random() * 9000)

  // Each native is its own one-material object, as a physics set places them (editor/physicsActions.ts).
  const jobs: { index: number; tag: NativeTag }[] = []
  for (const part of natives) {
    if (jobs.length % 5 === 0) opts.onProgress?.(`Making props and breakables (${jobs.length + 1}/${natives.length})…`)
    const m = await materialize([part])
    const it = m.items[0]
    const tex = it.textures.side ?? it.textures.top
    const obj = 'ball' in part.native! && part.native.ball ? ballObj(part.size[0]) : oneMaterial(shapeObj(it.shape!))
    const stored = await storeFile(new Blob([obj], { type: 'model/obj' }), 'prop.obj')
    Object.assign(p.files, { [tex]: m.files[tex], [stored.vpath]: stored.ref } as Record<string, FileRef>)
    const { shape: _shape, ...rest } = it
    jobs.push({ index: p.scene_items.length, tag: part.native! })
    p.scene_items.push({ ...rest, name: part.label, path: stored.vpath, source_path: stored.vpath, textures: { m0: tex }, alpha: { m0: !!it.alpha.side }, surface_ids: { m0: it.surface_ids?.side ?? 0 } })
  }
  if (jobs.length) {
    opts.onProgress?.('Turning them into props and breakables…')
    await (opts.convert ?? pythonNatives)(p, jobs)
  }

  if (p.markers.some((m) => m.type === ITEM_PROP || m.type === SOUND_ZONE)) {
    const names = await (opts.gameNames ?? namesFromGame)().catch(() => ({} as { item?: string; sound?: string }))
    for (const m of p.markers) {
      if (m.type === ITEM_PROP && names.item) m.item = m.label = names.item
      if (m.type === SOUND_ZONE && names.sound) m.sound = names.sound
    }
  }
  return p
}

const pythonNatives: NativeConverter = async (p, jobs) => {
  const { py } = await import('./py')
  await py.syncProject(p)
  const ws = p.settings.world_scale
  for (const { index, tag } of jobs) {
    const old = p.scene_items[index]
    const others = p.scene_items.filter((x, j) => j !== index && isGlass(x))
    if ('breakable' in tag) {
      const item = await py.sceneOp<SceneItem>('convert_breakable', { item: old, render_mode: tag.breakable, world_scale: ws, others })
      p.scene_items[index] = { ...item, uid: old.uid, native_profile: tag.profile }
      continue
    }
    // The fields a preset sets (editor/physicsActions.ts presetFields).
    const preset = PRESET_BY_KEY[tag.preset]
    const item = await py.sceneOp<SceneItem>('native_prop', { item: old, behavior: preset.behavior, world_scale: ws, others })
    p.scene_items[index] = {
      ...item, uid: old.uid, name: `${preset.label}: ${old.name}`, physics_preset: preset.key, physics_shape: tag.shape ?? preset.shape,
      native_profile: preset.behavior === 'movable' && preset.profile !== 'Crate Small' ? preset.profile : undefined,
      ...(tag.bottomHeavy ? { physics_bottom_heavy: true } : {}),
    }
  }
}

/** An item and a sound from the player's game files, without asking for the folder; nothing when it isn't connected. */
async function namesFromGame(): Promise<{ item?: string; sound?: string }> {
  const [{ loadItems }, { loadSoundNames }] = await Promise.all([import('./gameObjects/items'), import('./gameFiles')])
  const [items, sounds] = await Promise.all([loadItems(false).catch(() => null), loadSoundNames(false).catch(() => null)])
  return {
    item: (items?.find((i) => i.preload && !i.touch) ?? items?.[0])?.name,
    sound: sounds?.find((n) => /BIRD/i.test(n)) ?? sounds?.[0],
  }
}

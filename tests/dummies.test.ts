// Decoy dummies (src/lib/dummies): the stand-in figure and its body boxes, the recipe, how a dummy goes where the
// game's files can't, its collision, and the bake. The last block bakes real characters from a local Saints Reborn
// install and is skipped when there is none; nothing from the game is written anywhere.
import { describe, expect, it, vi } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { GAME_TESTS } from './testMode'
import { newProject, type FileRef, type Project, type SceneItem } from '../src/lib/project'
import { parseObj, type ObjModel } from '../src/lib/geometry'

// An in-memory blob store for the share plan.
const blobs = new Map<string, Blob>()
vi.mock('../src/lib/db', async (orig) => ({ ...(await orig<typeof import('../src/lib/db')>()), db: { getBlob: async (h: string) => blobs.get(h), hasBlob: async (h: string) => blobs.has(h), getMeta: async () => undefined, setMeta: async () => {} } }))

const { BODY_MAT, BOX_TRIANGLES, POSE_IDS, STAND_IN_MATS, bodySegments, figureJoints, segmentCorners, standInObj } = await import('../src/lib/dummies/figure')
const { MAX_DUMMIES, PLAYER, dummyName, fullLook, lookKey, specKey } = await import('../src/lib/dummies/models')
const { asStandIn, hasBuiltDummy, overDummyCap, withStandIns } = await import('../src/lib/dummies/standIn')
const { cleanRecipe, recipeProblem } = await import('../src/lib/recipes')
const { gameObjectPaths, showsGameData } = await import('../src/lib/gameObjects/policy')
const { collisionFromProject } = await import('../src/lib/analysis/collision')
const { mapChecklist } = await import('../src/lib/checklist')
const { npcDraws } = await import('../src/lib/dummies/bake')
const { dummyObjText } = await import('../src/lib/dummies/place')
const { projectUploadPlan, showcasePlan } = await import('../src/lib/hubRules')
const { planShare } = await import('../src/play/makeShare')

type V = [number, number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const pos = (m: ObjModel, i: number): V => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]
const matOf = (m: ObjModel, f: number) => m.mats[m.faceMat[f]]

/** Triangles of a material, and how many face away from the middle of their own box (12 a box, in order). */
function boxes(m: ObjModel, mat: string) {
  const faces = [...Array(m.faces.length / 3).keys()].filter((f) => matOf(m, f) === mat)
  let outward = 0
  for (let b = 0; b < faces.length / BOX_TRIANGLES; b++) {
    const own = faces.slice(b * BOX_TRIANGLES, (b + 1) * BOX_TRIANGLES)
    const pts = own.flatMap((f) => [0, 1, 2].map((k) => pos(m, m.faces[3 * f + k])))
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length] as V, [0, 0, 0] as V)
    for (const f of own) {
      const [a, bb, cc] = [0, 1, 2].map((k) => pos(m, m.faces[3 * f + k]))
      if (dot(cross(sub(bb, a), sub(cc, a)), sub(a, c)) > 0) outward++
    }
  }
  return { faces: faces.length, outward }
}

describe('the stand-in figure', () => {
  it('stands every pose on the ground, at a person\'s height', () => {
    for (const pose of POSE_IDS) {
      const j = figureJoints(pose)
      expect(Math.min(j.lAnkle[1], j.rAnkle[1]), pose).toBeCloseTo(0.08, 5)
      expect(j.head[1], pose).toBeGreaterThan(pose === 'crouch' ? 1 : 1.5)
      expect(j.head[1], pose).toBeLessThan(1.8)
      // Facing -Z: the right hand is on the +X side.
      expect(j.rShoulder[0]).toBeGreaterThan(0)
      expect(j.lShoulder[0]).toBeLessThan(0)
    }
    expect(figureJoints('crouch').pelvis[1]).toBeLessThan(figureJoints('standing').pelvis[1] - 0.25)
    const aim = figureJoints('aim')
    expect(aim.rShoulder[2] - aim.rWrist[2]).toBeGreaterThan(0.45)
    expect(Math.abs(aim.rWrist[1] - aim.rShoulder[1])).toBeLessThan(0.12)
    const out = figureJoints('mannequin')
    expect(out.rWrist[0] - out.rShoulder[0]).toBeGreaterThan(0.3)
    expect(out.lShoulder[0] - out.lWrist[0]).toBeGreaterThan(0.3)
  })

  it('is drawn but not solid, with 13 solid body boxes facing out, in editor units', () => {
    for (const pose of POSE_IDS) {
      const m = parseObj(standInObj(pose, 0.5))
      expect(new Set(m.mats)).toEqual(new Set([...Object.values(STAND_IN_MATS), BODY_MAT]))
      const body = boxes(m, BODY_MAT)
      expect(body.faces).toBe(13 * BOX_TRIANGLES)
      expect(body.outward).toBe(body.faces)
      const look = Object.values(STAND_IN_MATS).reduce((a, mat) => a + boxes(m, mat).outward, 0)
      expect(look).toBe(13 * BOX_TRIANGLES)
      let top = -Infinity, low = Infinity
      for (let i = 0; i < m.positions.length / 3; i++) { top = Math.max(top, m.positions[3 * i + 1]); low = Math.min(low, m.positions[3 * i + 1]) }
      // Units: 2 per metre at the default world scale.
      expect(low).toBeGreaterThanOrEqual(-1e-6)
      expect(top / 2).toBeGreaterThan(pose === 'crouch' ? 1.1 : 1.6)
      expect(top / 2).toBeLessThan(1.95)
    }
    const big = parseObj(standInObj('standing', 0.25))
    expect(Math.max(...big.positions.filter((_, i) => i % 3 === 1)) / 4).toBeLessThan(1.95)
  })

  it('puts boxes along the limbs, sized like a body', () => {
    const segs = bodySegments(figureJoints('standing'))
    expect(segs).toHaveLength(13)
    for (const s of segs) for (const c of segmentCorners(s)) expect(c.every(Number.isFinite)).toBe(true)
  })
})

describe('the figure recipe', () => {
  it('is checked and cleaned like the others', () => {
    expect(recipeProblem({ kind: 'figure', pose: 'aim', ws: 0.5 })).toBeNull()
    expect(recipeProblem({ kind: 'figure', pose: 'dance', ws: 0.5 })).not.toBeNull()
    expect(recipeProblem({ kind: 'figure', pose: 'aim', ws: 0 })).not.toBeNull()
    expect(recipeProblem({ kind: 'figure', pose: 'aim', ws: 0.5, extra: 1 })).not.toBeNull()
    expect(cleanRecipe({ kind: 'figure', pose: 'crouch', ws: 0.5, junk: 'x' } as never)).toEqual({ kind: 'figure', pose: 'crouch', ws: 0.5 })
  })
})

describe('looks', () => {
  it('fills defaults and keys the same look the same', () => {
    expect(fullLook(PLAYER)).toEqual({ top: 'black', skin: 'light', hair: 'brown', outfit: 0 })
    expect(fullLook('vk_x_m_thug1-01').top).toBe('yellow')
    expect(specKey({ model: PLAYER, pose: 'aim', look: {} })).toBe(specKey({ model: PLAYER, pose: 'aim', look: { top: 'black', outfit: 3 } }))
    expect(lookKey({ model: PLAYER, look: { top: 'red' } })).not.toBe(lookKey({ model: PLAYER, look: { top: 'blue' } }))
    expect(dummyName({ model: PLAYER, pose: 'standing', look: { top: 'purple' } })).toBe('Dummy (player, purple top)')
    expect(dummyName({ model: 'lw_x_m_officer_01', pose: 'standing', look: {} })).toBe('Dummy (police officer)')
  })
})

// ---------------- a dummy in a project ----------------

const ref = (name: string, origin: FileRef['origin'], recipe?: FileRef['recipe']): FileRef => ({ hash: name, size: 1, name, type: '', origin, ...(recipe ? { recipe } : {}) })
const STAND = '/work/f/stand/dummy_standing.obj'
const STAND_TEX = Object.fromEntries([...Object.values(STAND_IN_MATS), BODY_MAT].map((m) => [m, `/work/f/${m}/${m}.png`]))
const GAME_OBJ = '/work/f/game/dummy_player.obj'

/** A project with one dummy built from the game, and a plain box. */
function project(): Project {
  const p = newProject('Decoys')
  const paint = { kind: 'generated', params: { kind: 'paint', size: 32, color: '#202022', accent: '#202022', scale: 2, wear: 0, seed: 1 } } as FileRef['recipe']
  p.files[STAND] = ref('stand', 'user', { kind: 'figure', pose: 'standing', ws: 0.5 })
  for (const [m, path] of Object.entries(STAND_TEX)) p.files[path] = ref(m, 'user', paint)
  p.files[GAME_OBJ] = ref('game', 'game')
  p.files['/work/f/skin/body_0.png'] = ref('skin', 'game')
  const dummy: SceneItem = {
    uid: 'd1', name: 'Dummy (player, black top)', path: GAME_OBJ, source_path: GAME_OBJ, position: [0, 0, 0], rotation: [0, 90, 0], scale: 1,
    textures: { body_0: '/work/f/skin/body_0.png', [BODY_MAT]: STAND_TEX[BODY_MAT] }, alpha: { body_0: false, [BODY_MAT]: true },
    collision_materials: [BODY_MAT], game_look: { path: GAME_OBJ, layers: [] },
    dummy: { source: 'dummy', model: PLAYER, pose: 'standing', look: { top: 'black' }, ws: 0.5, built: true, stand_in: { path: STAND, textures: STAND_TEX } },
  }
  p.scene_items.push(dummy)
  return p
}

describe('a dummy where the game\'s files can\'t go', () => {
  it('turns into its stand-in, keeping its place and its recipe', () => {
    const p = project()
    const s = asStandIn(p.scene_items[0])
    expect(s.path).toBe(STAND)
    expect(s.textures).toEqual(STAND_TEX)
    expect(s.collision_materials).toEqual([BODY_MAT])
    expect(s.alpha[BODY_MAT]).toBe(true)
    expect(s.surface_ids?.[BODY_MAT]).toBe(6)
    expect(s.game_look).toBeUndefined()
    expect(s.rotation).toEqual([0, 90, 0])
    expect(s.dummy).toMatchObject({ model: PLAYER, pose: 'standing', built: false })
    expect(s.triangles).toBe(26 * BOX_TRIANGLES)
    expect(hasBuiltDummy(p.scene_items)).toBe(true)
    expect(hasBuiltDummy([s])).toBe(false)
    const w = withStandIns(p)
    expect(Object.values(w.files).some((f) => f.origin === 'game')).toBe(false)
    expect(p.files[GAME_OBJ]).toBeDefined()
  })

  it('counts as game data in a picture of the view while it is built, not as its stand-in', () => {
    const p = project()
    expect(showsGameData(p)).toBe(true)
    expect(showsGameData(withStandIns(p))).toBe(false)
  })

  it('leaves its character out of backups but keeps the stand-in', () => {
    const paths = gameObjectPaths(project())
    expect(paths.has(GAME_OBJ)).toBe(true)
    expect(paths.has('/work/f/skin/body_0.png')).toBe(true)
    expect(paths.has(STAND)).toBe(false)
  })

  it('goes to the hub and the Showcase as its stand-in, with no game files', () => {
    const p = project()
    p.markers = []
    const plan = projectUploadPlan(p)
    expect(plan.blockers.filter((b) => /game files/.test(b))).toEqual([])
    expect(plan.local.some((f) => f.path === GAME_OBJ)).toBe(false)
    const show = showcasePlan(p, new Set())
    expect(show.blockers.filter((b) => /Saints Row game files|you added yourself/.test(b))).toEqual([])
    expect(show.snapshot.scene_items[0].path).toBe(STAND)
    expect(show.snapshot.files[STAND].recipe).toEqual({ kind: 'figure', pose: 'standing', ws: 0.5 })
  })

  it('goes into a share link as the stand-in figure, with its own keys', async () => {
    const p = project()
    blobs.set('stand', new Blob([standInObj('standing', 0.5)], { type: 'model/obj' }))
    const plan = await planShare(p, { title: 'Decoys' })
    expect(plan.issues).toEqual([])
    expect(plan.dropped).toBe(0)
    const it = plan.doc.project.scene_items[0]
    expect(it.path).toMatch(/^mesh\//)
    expect(it.dummy!.stand_in.path).toBe(it.path)
    expect(JSON.stringify(plan.doc)).not.toContain('/work/')
    expect(plan.doc.models[it.path]).toContain('usemtl ' + BODY_MAT)

    // As the share function checks and stores it: materials renamed m0, m1…, and the dummy's solid material and
    // stand-in pictures renamed with them, so only the body boxes still collide.
    const { validateShareDoc } = await import('../src/play/share')
    const { problems, doc } = validateShareDoc(plan.doc)
    expect(problems).toEqual([])
    const kept = doc!.project.scene_items[0]
    expect(doc!.models[kept.path]).not.toContain(BODY_MAT)
    expect(kept.collision_materials).toHaveLength(1)
    expect(doc!.models[kept.path]).toContain('usemtl ' + kept.collision_materials![0])
    expect(kept.dummy).toMatchObject({ source: 'dummy', built: false, stand_in: { path: kept.path, textures: kept.textures } })
    const m = parseObj(doc!.models[kept.path])
    expect(collisionFromProject(doc!.project, () => m).tris.length / 9).toBe(13 * BOX_TRIANGLES)

    // A dummy whose stand-in is another model isn't a dummy in a share.
    const odd = structuredClone(plan.doc)
    odd.project.scene_items[0].dummy!.stand_in.path = 'mesh/elsewhere'
    expect(validateShareDoc(odd).doc!.project.scene_items[0].dummy).toBeUndefined()

    // Nor is one whose model isn't exactly its figure: other geometry under the stand-in's material names (a body
    // box named like the figure's), a model with no materials at all, or the figure in another pose.
    const { cleanObj } = await import('../src/play/share')
    const forged = (model: string) => {
      const d = structuredClone(plan.doc)
      d.models[d.project.scene_items[0].path] = cleanObj(model)!
      return validateShareDoc(d).doc!.project.scene_items[0]
    }
    expect(forged(`v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nusemtl ${BODY_MAT}\nf 1 2 3\nusemtl body_0\nf 1 3 4\n`).dummy).toBeUndefined()
    expect(forged('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').dummy).toBeUndefined()
    expect(forged(standInObj('aim', 0.5)).dummy).toBeUndefined()
    // The real figure stays a dummy, its solid material renamed with the rest.
    expect(forged(standInObj('standing', 0.5)).dummy).toMatchObject({ source: 'dummy', pose: 'standing' })
    // Materials are renamed before the comparison, so another material name on the figure's own geometry is still
    // just the figure; moving any of its points is not.
    const swapped = structuredClone(plan.doc)
    swapped.models[it.path] = swapped.models[it.path].replace(/usemtl dummy_skin/g, 'usemtl body_0')
    expect(validateShareDoc(swapped).doc!.project.scene_items[0].dummy).toMatchObject({ source: 'dummy', pose: 'standing' })
    const moved = structuredClone(plan.doc)
    moved.models[it.path] = moved.models[it.path].replace(/^v (\S+)/m, (_: string, x: string) => `v ${+x + 0.5}`).replace(/usemtl dummy_skin/g, 'usemtl body_0')
    expect(validateShareDoc(moved).doc!.project.scene_items[0].dummy).toBeUndefined()
  })

  it('is refused by the Showcase when it isn’t its stand-in figure', () => {
    const p = project()
    p.markers = []
    const show = showcasePlan(p, new Set())
    const forged = JSON.parse(JSON.stringify(show.snapshot)) as Project
    forged.files[forged.scene_items[0].path].recipe = { kind: 'shape', shape: { kind: 'box', size: [1, 1, 1], tile: 1 } }
    expect(showcasePlan(forged, new Set()).blockers.join(' ')).toMatch(/isn't its stand-in figure/)
  })
})

describe('collision', () => {
  it('is only the body boxes', () => {
    const p = project()
    const m = parseObj(standInObj('standing', 0.5))
    const s = asStandIn(p.scene_items[0])
    const solid = collisionFromProject({ ...p, scene_items: [s] }, () => m)
    expect(solid.tris.length / 9).toBe(13 * BOX_TRIANGLES)
    const all = collisionFromProject({ ...p, scene_items: [{ ...s, collision_materials: undefined }] }, () => m)
    expect(all.tris.length / 9).toBe(26 * BOX_TRIANGLES)
  })
})

describe('the cap', () => {
  it('refuses edits that add dummies past it, wherever they come from', () => {
    const one = project().scene_items[0]
    const n = (k: number) => Array.from({ length: k }, (_, i) => ({ ...one, uid: 'u' + i }))
    expect(overDummyCap(n(11), n(12))).toBeNull()
    expect(overDummyCap(n(12), n(13))).toMatch(/at most 12 dummies/)
    expect(overDummyCap(n(14), n(13))).toBeNull()
    expect(overDummyCap(n(14), n(14))).toBeNull()
    expect(overDummyCap([], [{}, {}])).toBeNull()
  })

  it('is kept by every edit in the editor (a copy, a paste, mirror mode)', async () => {
    const { useEditor } = await import('../src/editor/store')
    const p = project()
    for (let i = 1; i < MAX_DUMMIES; i++) p.scene_items.push({ ...p.scene_items[0], uid: 'c' + i })
    useEditor.setState({ project: p, past: [], future: [] })
    useEditor.getState().update('Duplicate', (d) => { d.scene_items.push({ ...d.scene_items[0], uid: 'thirteen' }) })
    expect(useEditor.getState().project!.scene_items.length).toBe(MAX_DUMMIES)
    expect(useEditor.getState().past.length).toBe(0)
    useEditor.getState().update('Rename', (d) => { d.scene_items[0].name = 'Shop dummy' })
    expect(useEditor.getState().project!.scene_items[0].name).toBe('Shop dummy')
    // A saved version comes back as it was, over the cap or not (the checklist still blocks the export).
    useEditor.getState().update('Restore version', (d) => { d.scene_items.push({ ...d.scene_items[0], uid: 'old' }) }, { restore: true })
    expect(useEditor.getState().project!.scene_items.length).toBe(MAX_DUMMIES + 1)
  })
})

describe('the map checklist', () => {
  it('suggests deleting dummies past the cap', () => {
    const p = project()
    expect(mapChecklist(p, true).some((c) => c.id === 'dummies')).toBe(false)
    for (let i = 0; i < MAX_DUMMIES; i++) p.scene_items.push({ ...p.scene_items[0], uid: 'x' + i })
    // Past the cap it blocks the export.
    expect(mapChecklist(p, true).find((c) => c.id === 'dummies')?.state).toBe('needed')
  })

  it('warns about dummies made at another world scale', () => {
    const p = project()
    expect(mapChecklist(p, true).some((c) => c.id === 'dummy-scale')).toBe(false)
    p.settings.world_scale = 0.25
    expect(mapChecklist(p, true).find((c) => c.id === 'dummy-scale')?.text).toMatch(/^1 decoy dummy was made before the world scale changed/)
  })
})

describe('picking a person\'s variant', () => {
  const draw = (start: number, mat: number) => ({ start, count: 30, mat })
  // Body (vid 0) with two skin tones of the same arms, two heads, two shirts, an extra.
  const cmesh = {
    records: [{ subs: [] }],
    vids: [
      { record: 0, vid: 0, draws: [draw(0, 0), draw(100, 1), draw(100, 2)] },
      { record: 0, vid: 1, draws: [draw(200, 3)] }, { record: 0, vid: 2, draws: [draw(300, 4)] },
      { record: 0, vid: 20, draws: [draw(400, 5)] }, { record: 0, vid: 21, draws: [draw(500, 6)] },
      { record: 0, vid: 100, draws: [draw(600, 7)] },
      { record: 1, vid: 0, draws: [draw(900, 9)] },
    ],
  } as never
  const mats = (dark: boolean, outfit: number) => npcDraws(cmesh, dark, outfit).map((d) => d.mat).sort()
  it('takes one head, one of each piece and every extra; dark picks the second head and the last tone', () => {
    expect(mats(false, 0)).toEqual([0, 1, 3, 5, 7])
    expect(mats(true, 0)).toEqual([0, 2, 4, 5, 7])
    expect(mats(false, 1)).toEqual([0, 1, 3, 6, 7])
    expect(mats(false, 2)).toEqual([0, 1, 3, 5, 7])
  })
})

// ---------------- from a local install ----------------

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(GAME + '/misc2.vpp_xbox2') && existsSync(GAME + '/cmesh_stream.vpp_xbox2')

describe.skipIf(!GAME_TESTS || !haveGame)('dummies baked from a local game install', async () => {
  const { PACKFILES } = await import('../src/lib/sr1char/folder')
  const { openVpp } = await import('../src/lib/sr1char/vpp')
  const { bakeDummy } = await import('../src/lib/dummies/bake')
  const { pictureKey } = await import('../src/lib/dummies/pictures')
  const packs = async () => {
    const out = []
    for (const n of PACKFILES) if (existsSync(GAME + '/' + n)) out.push(await openVpp(await openAsBlob(GAME + '/' + n), n))
    return out
  }
  /** The top of the solid body boxes, metres. */
  const boxTop = (b: Awaited<ReturnType<typeof bakeDummy>>) => {
    const m = parseObj(dummyObjText(b, 0.5, 'dummy'))
    let top = -Infinity
    for (let f = 0; f < m.faces.length / 3; f++) if (matOf(m, f) === BODY_MAT) for (let k = 0; k < 3; k++) top = Math.max(top, m.positions[3 * m.faces[3 * f + k] + 1] * 0.5)
    return top
  }
  const facingOut = (b: Awaited<ReturnType<typeof bakeDummy>>) => {
    let n = 0
    const p = (i: number): V => [b.positions[3 * i], b.positions[3 * i + 1], b.positions[3 * i + 2]]
    const tris = b.triangles.length / 3
    for (let t = 0; t < tris; t++) {
      const [a, c, d] = [0, 1, 2].map((k) => b.triangles[3 * t + k])
      const vn: V = [0, 1, 2].map((k) => b.normals[3 * a + k] + b.normals[3 * c + k] + b.normals[3 * d + k]) as V
      if (dot(cross(sub(p(c), p(a)), sub(p(d), p(a))), vn) > 0) n++
    }
    return n / tris
  }

  it('bakes the player in every pose: feet on the ground, facing out, its joints where the pose puts them', async () => {
    const ps = await packs()
    for (const pose of POSE_IDS) {
      const b = await bakeDummy(ps, { model: PLAYER, pose, look: {} })
      let low = Infinity
      for (let i = 1; i < b.positions.length; i += 3) low = Math.min(low, b.positions[i])
      expect(low, pose).toBeCloseTo(0, 5)
      expect(b.height, pose).toBeGreaterThan(pose === 'crouch' ? 1 : 1.65)
      expect(b.height, pose).toBeLessThan(1.9)
      expect(facingOut(b), pose).toBeGreaterThan(0.97)
      expect(b.triangles.length / 3).toBeGreaterThan(4000)
      expect(b.materials.length).toBeLessThanOrEqual(16)
      for (const m of b.materials) expect(Math.max(m.picture.width, m.picture.height)).toBeLessThanOrEqual(512)
      // The body boxes reach the top of the head (the hair).
      expect(boxTop(b), pose).toBeGreaterThanOrEqual(b.height - 0.03)
      if (pose === 'aim') {
        expect(b.joints.rShoulder[2] - b.joints.rWrist[2]).toBeGreaterThan(0.4)
        expect(Math.abs(b.joints.rWrist[1] - b.joints.rShoulder[1])).toBeLessThan(0.15)
      }
    }
  }, 120_000)

  it('dresses the player in the chosen top, the same pictures for the same look', async () => {
    const ps = await packs()
    const keys = async (top: 'black' | 'purple') => (await bakeDummy(ps, { model: PLAYER, pose: 'standing', look: { top } })).materials.map((m) => pictureKey(m.picture)).sort()
    const black = await keys('black')
    expect(await keys('black')).toEqual(black)
    expect(await keys('purple')).not.toEqual(black)
  }, 120_000)

  it('bakes the people on the list, standing at a person\'s height, as an OBJ with its body boxes', async () => {
    const ps = await packs()
    const { NPC_MODELS } = await import('../src/lib/dummies/models')
    for (const model of Object.keys(NPC_MODELS)) {
      const b = await bakeDummy(ps, { model, pose: 'standing', look: {} })
      expect(b.height, model).toBeGreaterThan(1.4)
      expect(b.height, model).toBeLessThan(2)
      expect(facingOut(b), model).toBeGreaterThan(0.95)
      expect(b.triangles.length / 3, model).toBeGreaterThan(1500)
      const m = parseObj(dummyObjText(b, 0.5, model))
      expect(boxes(m, BODY_MAT).faces).toBe(13 * BOX_TRIANGLES)
      expect(boxTop(b), model).toBeGreaterThanOrEqual(b.height - 0.03)
      expect(m.faces.length / 3).toBe(b.triangles.length / 3 + 13 * BOX_TRIANGLES)
    }
  }, 180_000)
})

// Editor commands for physics props (see lib/physicsProps.ts). Turning an
// object into a native prop goes through the same Python rules as the
// "Movable and explosive props", under the inspector's More settings.
import { useEditor, currentProject, mirrorPaused } from './store'
import { py } from '../lib/py'
import { isGlass, isProp, type FileRef, type SceneItem, type Vec3 } from '../lib/project'
import { OBJECT_BUDGET, PRESET_BY_KEY, type PhysicsShape } from '../lib/physicsProps'
import { ballObj, oneMaterial, type PhysicsPart } from '../lib/prefabsPhysics'
import { ALL_PREFABS } from '../lib/prefabRegistry'
import { storeFile } from '../lib/files'
import { UserError } from './actions'

const update = (...a: Parameters<ReturnType<typeof useEditor.getState>['update']>) => useEditor.getState().update(...a)

const originalName = (it: SceneItem) => String(it.native_prop_original_name ?? it.native_original_name ?? it.name)

/** The fields a preset sets on an item that is already a native prop of the right kind. */
function presetFields(d: SceneItem, key: string, keepShape: boolean, shape?: PhysicsShape) {
  const p = PRESET_BY_KEY[key]
  d.physics_preset = key
  d.native_profile = p.behavior === 'movable' && p.profile !== 'Crate Small' ? p.profile : undefined
  if (!keepShape) d.physics_shape = shape ?? p.shape
  d.name = `${p.label}: ${originalName(d)}`
}

/** A block-out shape (top and side materials) as one-material OBJ wearing its side texture: a prop has one material. */
async function oneMaterialShape(it: SceneItem) {
  if (!it.shape || Object.keys(it.textures).length < 2) return null
  const { shapeObj } = await import('../lib/shapes')
  const stored = await storeFile(new Blob([oneMaterial(shapeObj(it.shape))], { type: 'model/obj' }), 'prop.obj')
  const tex = it.textures.side ?? Object.values(it.textures)[0]
  const { shape: _shape, ...rest } = it
  const item: SceneItem = { ...rest, path: stored.vpath, source_path: stored.vpath, textures: { m0: tex }, alpha: { m0: !!it.alpha?.side }, surface_ids: { m0: it.surface_ids?.side ?? 0 } }
  return { item, file: stored }
}

/** Makes the objects physics props with a behaviour preset (or switches the preset of ones that are). */
export async function makePhysicsProps(indices: number[], key: string) {
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const preset = PRESET_BY_KEY[key]
  const p = currentProject()
  if (!p || !preset) return
  indices = indices.filter((i) => i > 0 && i < p.scene_items.length)
  if (!indices.length) throw new UserError('Pick an object you placed, not the base map.')
  const fresh = indices.filter((i) => !isGlass(p.scene_items[i]))
  const natives = p.scene_items.filter(isGlass).length
  if (natives + fresh.length > OBJECT_BUDGET) throw new UserError(`A map holds at most ${OBJECT_BUDGET} physics props, breakables and glass panes (${natives} already). Pick fewer objects.`)
  const converted = new Map<number, SceneItem>()
  const errors: string[] = []
  const others = () => currentProject()!.scene_items.filter((x, j) => isGlass(x) && !indices.includes(j))
  // Block-out shapes first become one-material models.
  const single = new Map<number, SceneItem>()
  const files: Record<string, FileRef> = {}
  // A block-out box or cylinder keeps a collider of its own kind, whatever the preset's usual one.
  const fit = new Map<number, PhysicsShape>()
  for (const i of indices) {
    const kind = p.scene_items[i].shape?.kind
    if (kind && !isGlass(p.scene_items[i])) fit.set(i, kind === 'cylinder' ? 'cylinder' : kind === 'box' ? 'box' : 'hull')
    const one = isGlass(p.scene_items[i]) ? null : await oneMaterialShape(p.scene_items[i])
    if (!one) continue
    single.set(i, one.item)
    files[one.file.vpath] = one.file.ref
  }
  await py.syncProject({ ...p, files: { ...p.files, ...files }, scene_items: [...p.scene_items, ...single.values()] })
  for (const i of indices) {
    const it = single.get(i) ?? p.scene_items[i]
    if (isProp(it) && it.native_prop_behavior === preset.behavior) continue
    if (isGlass(it) && !isProp(it) && it.native_breakable_kind !== 'wood') { errors.push(`${it.name}: glass keeps its glass behaviour.`); continue }
    try {
      converted.set(i, await py.sceneOp<SceneItem>('native_prop', { item: it, behavior: preset.behavior, world_scale: p.settings.world_scale, others: others() }))
    } catch (e) { errors.push(`${it.name}: ${(e as Error).message}`) }
  }
  const done = indices.filter((i) => converted.has(i) || isProp(p.scene_items[i]))
  if (done.length) {
    update('Physics prop: ' + preset.label, (d) => {
      Object.assign(d.files, files)
      for (const i of done) {
        const keepShape = !converted.has(i) && !!d.scene_items[i].physics_shape
        if (converted.has(i)) d.scene_items[i] = { ...converted.get(i)!, uid: d.scene_items[i].uid }
        presetFields(d.scene_items[i], key, keepShape, fit.get(i))
      }
    }, { noMirror })
    useEditor.getState().log(`${done.length} object(s) are now "${preset.label}" physics props. Try them in Walk (shoot, G to blast); re-export the map to play them in game.`)
  }
  if (errors.length) throw new UserError(errors.slice(0, 4).join('\n') + (errors.length > 4 ? `\n…and ${errors.length - 4} more` : ''))
}

export function setPhysicsShape(index: number, shape: PhysicsShape) {
  update('Physics shape', (d) => { d.scene_items[index].physics_shape = shape })
}

export function setBottomHeavy(index: number, on: boolean) {
  update('Bottom-heavy', (d) => { d.scene_items[index].physics_bottom_heavy = on || undefined })
}

/** Places a physics showcase set (lib/prefabsPhysics.ts): its static parts as one object, each prop as its own physics prop. */
export async function addPhysicsSet(key: string, at: Vec3, groundY: number | null, rot = 0) {
  // Called inside withoutMirror (the AI), its edit isn't mirrored either.
  const noMirror = mirrorPaused()
  const def = ALL_PREFABS[key]
  const p = currentProject()
  if (!def || !p) return
  const parts = def.make(at[0], at[2], rot, groundY ?? 0) as PhysicsPart[]
  const props = parts.filter((x) => x.physics)
  const natives = p.scene_items.filter(isGlass).length
  if (natives + props.length > OBJECT_BUDGET) throw new UserError(`${def.label} adds ${props.length} physics props; this map has room for ${OBJECT_BUDGET - natives} more (at most ${OBJECT_BUDGET} per map).`)
  const { materialize } = await import('../lib/samples')
  const { shapeObj } = await import('../lib/shapes')
  const built = await materialize(parts.filter((x) => !x.physics))
  const items = [...built.items]
  const files = { ...built.files }
  for (const part of props) {
    // The part's texture, then its shape (or a ball) as one-material OBJ.
    const m = await materialize([part])
    const tex = m.items[0].textures.top
    files[tex] = m.files[tex]
    const obj = part.physics!.ball ? ballObj(part.size[0]) : oneMaterial(shapeObj(m.items[0].shape!))
    const stored = await storeFile(new Blob([obj], { type: 'model/obj' }), 'prop.obj')
    files[stored.vpath] = stored.ref
    const { shape: _shape, ...rest } = m.items[0]
    items.push({ ...rest, name: part.label, path: stored.vpath, source_path: stored.vpath, textures: { m0: tex }, alpha: { m0: false }, surface_ids: { m0: m.items[0].surface_ids?.top ?? 0 } })
  }
  const start = p.scene_items.length
  update('Add ' + def.label.toLowerCase(), (d) => {
    Object.assign(d.files, files)
    d.scene_items.push(...items)
  }, { noMirror })
  const first = start + built.items.length
  const byPreset = new Map<string, number[]>()
  props.forEach((part, k) => {
    const list = byPreset.get(part.physics!.preset) ?? []
    list.push(first + k)
    byPreset.set(part.physics!.preset, list)
  })
  for (const [preset, list] of byPreset) await makePhysicsProps(list, preset)
  update('Physics shapes', (d) => {
    props.forEach((part, k) => {
      const it = d.scene_items[first + k]
      if (part.physics!.shape) it.physics_shape = part.physics!.shape
      if (part.physics!.bottomHeavy) it.physics_bottom_heavy = true
    })
  }, { merge: 'physics-set', noMirror })
  useEditor.getState().select({ kind: 'item', index: first })
  useEditor.getState().log(`Added ${def.label.toLowerCase()}: ${props.length} physics props. Walk the map to try them (click shoots, G blasts).`)
}

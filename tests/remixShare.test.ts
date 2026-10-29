// "Remix in editor" for a play link (src/play/remixShare.ts): a share names
// every material m0, m1…; a model the share's settings make again gets its
// recipe's material names back, and the objects using it follow, so editing
// its shape later keeps its textures. An imported model stays as stored.
import { expect, it, vi } from 'vitest'
import { newProject, type Project } from '../src/lib/project'
import { compoundObj, shapeObj, type CompoundPiece, type Shape } from '../src/lib/shapes'
import { cleanObj, validateShareDoc } from '../src/play/share'
import { cleanBuilds } from '../src/play/shareBuilds'

const st = vi.hoisted(() => ({ doc: null as unknown, saved: null as Project | null, blobs: new Map<string, string>() }))
vi.mock('../src/lib/db', () => ({ db: { putProject: async (r: { project: Project }) => { st.saved = r.project } } }))
vi.mock('../src/lib/files', () => ({
  storeFile: async (b: Blob, name: string) => {
    const t = await b.text()
    const vpath = `/work/f/${st.blobs.size}/${name}`
    st.blobs.set(vpath, t)
    return { vpath, ref: { hash: 'h' + st.blobs.size, size: t.length, name, type: 'model/obj', origin: 'user' } }
  },
}))
vi.mock('../src/play/shareApi', () => ({ fetchShare: async () => st.doc }))
// Keeps what it was given that has a recipe (the real one makes the texture files from theirs).
vi.mock('../src/lib/showcase', () => ({ rebuildFromRecipes: async (p: Project) => ({ ...p, files: Object.fromEntries(Object.entries(p.files).filter(([, r]) => r.recipe)) }) }))

const { remixShare } = await import('../src/play/remixShare')

it('gives a model made again from its settings its recipe’s material names back, and the objects follow', async () => {
  const p = newProject('R')
  const box: Shape = { kind: 'box', size: [4, 1, 4], tile: 1 }
  const pieces: CompoundPiece[] = [
    { shape: { kind: 'box', size: [1, 1, 1], tile: 1 }, at: [0, 0, 0], rot: 0, top: 'brick', side: 'trim' },
    { shape: { kind: 'cylinder', size: [1, 2, 1], tile: 1, segments: 8 }, at: [3, 0, 0], rot: 45, top: 'glass', side: 'brick' },
  ]
  p.scene_items.push(
    { uid: 'a', name: 'Box', path: 'mesh/0', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { top: 'tex/0', side: 'tex/1' }, alpha: { top: false, side: true }, surface_ids: { top: 1, side: 2 } },
    { uid: 'b', name: 'Comp', path: 'mesh/1', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { brick: 'tex/0', trim: 'tex/1', glass: 'tex/1' }, alpha: { glass: true }, water_materials: ['glass'] },
    { uid: 'c', name: 'Imp', path: 'mesh/2', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, textures: { 'Mat One': 'tex/0' }, alpha: {} },
  )
  const raw = {
    format: 'sr1-map-studio-share', version: 1, title: 'R', created_at: '', project: p,
    models: { 'mesh/0': cleanObj(shapeObj(box))!, 'mesh/1': cleanObj(compoundObj(pieces))!, 'mesh/2': 'v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Mat One\nf 1 2 3\n' },
    textures: { 'tex/0': { kind: 'library', id: 'concrete' }, 'tex/1': { kind: 'library', id: 'concrete' } },
    made: { 'mesh/0': 'shape', 'mesh/1': 'compound', 'mesh/2': 'import' },
    builds: { 'mesh/0': { kind: 'shape', shape: box }, 'mesh/1': { kind: 'compound', pieces } },
  }
  const v = validateShareDoc(raw)
  expect(v.problems).toEqual([])
  st.doc = cleanBuilds(v.doc!).doc
  // As a link stores it, every material is m0, m1…
  expect(Object.keys((st.doc as typeof raw).project.scene_items[1].textures)).toEqual(['m0', 'm1', 'm2'])

  await remixShare('x')
  const [a, b, c] = st.saved!.scene_items
  const mats = (path: string) => [...new Set(st.blobs.get(path)!.split('\n').filter((l) => l.startsWith('usemtl ')).map((l) => l.slice(7)))].sort()
  expect(a).toMatchObject({ textures: { top: 'tex/0', side: 'tex/1' }, alpha: { top: false, side: true }, surface_ids: { top: 1, side: 2 } })
  expect(mats(a.path)).toEqual(['side', 'top'])
  expect(st.saved!.files[a.path].recipe).toEqual({ kind: 'shape', shape: box })
  expect(b).toMatchObject({ textures: { brick: 'tex/0', trim: 'tex/1', glass: 'tex/1' }, alpha: { glass: true }, water_materials: ['glass'] })
  expect(mats(b.path)).toEqual(['brick', 'glass', 'trim'])
  expect(st.saved!.files[b.path].recipe?.kind).toBe('compound')
  // An imported model has no settings to make it again: it keeps the share's names, and so does its object.
  expect(c.textures).toEqual({ m0: 'tex/0' })
  expect(mats(c.path)).toEqual(['m0'])
  expect(st.saved!.files[c.path].recipe).toBeUndefined()
})

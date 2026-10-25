// Development only (/dev/game-labels): a page for checking what identify() says about the "From my game" library
// against pictures of the models. It takes a seeded random sample of the most placed models, draws each one and
// shows its role, category, name and settings, and lets the reviewer mark each answer right or wrong. Marks stay
// in this browser (localStorage); "Results" sums them up per role. Needs the dev server's packfiles
// (SR1_PACKFILES) and reads the player's own game files only on this device.
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { buildIndex, getObject, useGameObjects } from '../lib/gameObjects/client'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { identify, type GameRole } from '../lib/gameObjects/identity'

const KEY = 'sr1:gameLabels'
type Mark = { role: boolean; category: boolean; name: boolean; note?: string; truth?: GameRole }
type Marks = Record<string, Mark>

const load = (): Marks => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }
const save = (m: Marks) => { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* private window */ } }

/** A small seeded random (mulberry32). */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** The sample: `count` of the `pool` most placed models, picked at random with `seed`. */
export function labelSample(entries: GameObjectEntry[], pool: number, count: number, seed: number): GameObjectEntry[] {
  const top = [...entries].sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id)).slice(0, pool)
  const r = rng(seed)
  for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [top[i], top[j]] = [top[j], top[i]] }
  return top.slice(0, count)
}

/** A bigger picture than the library's tiles (for counting a building's storeys), from the 3/4 view or straight at a side. */
async function bigPicture(obj: THREE.Object3D, px: number, side?: string): Promise<string> {
  const box = new THREE.Box3().setFromObject(obj)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a38, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-0.4, 1, 0.7)
  scene.add(sun, obj)
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), r = size.length() / 2 || 1
  // The editor mirrors X: the game's +x side is the editor's -x.
  const dir = side ? new THREE.Vector3(side[1] === 'x' ? (side[0] === '+' ? -1 : 1) : 0, 0.15, side[1] === 'z' ? (side[0] === '+' ? 1 : -1) : 0).normalize() : new THREE.Vector3(1, 0.8, 1.2).normalize()
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 8)
  cam.position.copy(c).addScaledVector(dir, r * 4)
  cam.lookAt(c)
  const ren = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  ren.setSize(px, px)
  ren.setClearColor(0x202028)
  ren.render(scene, cam)
  const url = ren.domElement.toDataURL('image/png')
  ren.dispose()
  return url
}

/** A building with every piece of its layout put where the game puts it (for checking layouts). */
async function composed(e: GameObjectEntry, all: GameObjectEntry[]): Promise<THREE.Object3D> {
  const { objectMesh } = await import('../lib/gameObjects/render')
  const g = new THREE.Group()
  g.add(objectMesh(await getObject(e, 128), 1))
  const by = new Map(all.map((x) => [x.id, x]))
  for (const p of e.layout ?? []) {
    const part = by.get(p.id)
    if (!part || identify(part).role === 'skip') continue
    const m = objectMesh(await getObject(part, 64), 1)
    // Editor space mirrors the game's X: the part's turn and offset are mirrored with it.
    m.rotation.y = p.yaw
    m.position.set(-p.at[0], p.at[1], p.at[2])
    g.add(m)
  }
  return g
}

function Picture({ e, big }: { e: GameObjectEntry; big?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const id = identify(e)
  useEffect(() => {
    let off = false, made = ''
    void (async () => {
      const [r, { objectMesh }, { drawObject }] = await Promise.all([getObject(e, big ? 256 : 128), import('../lib/gameObjects/render'), import('../lib/prefabRender')])
      const compose = new URLSearchParams(location.search).get('compose')
      if (big && compose) { const all = useGameObjects.getState().entries ?? []; const u = await bigPicture(compose === 'bare' ? objectMesh(r, 1) : await composed(e, all), big); if (!off) setUrl(u); return }
      if (big) { const u = await bigPicture(objectMesh(r, 1), big, new URLSearchParams(location.search).get('side') === 'front' ? id.building?.front : undefined); if (!off) setUrl(u); return }
      const blob = await drawObject(objectMesh(r, 1))
      if (blob && !off) setUrl((made = URL.createObjectURL(blob)))
    })().catch(() => !off && setUrl(''))
    return () => { off = true; if (made) URL.revokeObjectURL(made) }
  }, [e])
  const px = big ?? 124
  return url ? <img src={url} width={px} height={px} alt="" style={{ display: 'block' }} /> : <div style={{ width: px, height: px, display: 'grid', placeItems: 'center', opacity: 0.5 }}>{url === '' ? 'no picture' : '…'}</div>
}

export default function GameLabels() {
  const q = new URLSearchParams(location.search)
  const pool = +(q.get('pool') ?? 3000), count = +(q.get('count') ?? 300), seed = +(q.get('seed') ?? 1)
  const page = +(q.get('page') ?? 0), per = +(q.get('per') ?? 24), find = q.get('q'), big = q.get('big') ? +q.get('big')! : undefined
  const entries = useGameObjects((s) => s.entries)
  const [err, setErr] = useState('')
  const [marks, setMarks] = useState<Marks>(load)
  useEffect(() => {
    void (async () => {
      const dev = (window as unknown as { __sr1GameObjects?: { useDevServer(): Promise<string[]> } }).__sr1GameObjects
      await dev?.useDevServer()
      await buildIndex(false)
    })().catch((x) => setErr(String(x)))
  }, [])
  const sample = useMemo(() => {
    if (!entries) return []
    const kitOf = q.get('kit')
    if (kitOf) return entries.filter((e) => e.kitOf === kitOf || (e.cat === 'Buildings' && e.name.replace(/_hull\d*$/, '') === kitOf)).sort((a, b) => (b.cat === 'Buildings' ? 1 : 0) - (a.cat === 'Buildings' ? 1 : 0) || b.seen - a.seen).slice(0, count)
    if (find) { const re = new RegExp(find, 'i'); return entries.filter((e) => [e.name, ...(e.raw ?? []), ...e.tex, identify(e).name].some((s) => re.test(s))).sort((a, b) => b.seen - a.seen).slice(0, count) }
    return labelSample(entries, pool, count, seed)
  }, [entries, pool, count, seed, find, q.get('kit')])
  const set = (id: string, m: Partial<Mark>) => setMarks((all) => { const next = { ...all, [id]: { ...{ role: true, category: true, name: true }, ...all[id], ...m } }; save(next); return next })

  // For marking from the console: __gameLabels.mark(n, { name: false, truth: 'piece' }) marks the n-th model (1-based).
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__gameLabels = {
      ids: sample.map((e) => e.id),
      mark: (n: number, m: Partial<Mark> = {}) => set(sample[n - 1].id, m),
      describe: (n: number) => { const e = sample[n - 1]; return { e, id: identify(e) } },
      marks: () => load(),
    }
  }, [sample])

  const results = useMemo(() => {
    const by: Record<string, { n: number; role: number; category: number; name: number }> = {}
    for (const e of sample) {
      const m = marks[e.id]
      if (!m) continue
      const role = m.truth ?? identify(e).role
      const r = (by[role] ??= { n: 0, role: 0, category: 0, name: 0 })
      r.n++; r.role += m.role ? 1 : 0; r.category += m.category ? 1 : 0; r.name += m.name ? 1 : 0
    }
    return by
  }, [sample, marks])

  if (err) return <div className="page"><p>{err}</p></div>
  if (!entries) return <div className="page"><p className="muted">Reading the library…</p></div>
  const shown = sample.slice(page * per, page * per + per)
  return (
    <div style={{ padding: 4, fontSize: 11 }}>
      <div>Game model labels · {sample.length} models (pool {pool}, seed {seed}) · page {page + 1}/{Math.ceil(sample.length / per)} · {sample.filter((e) => marks[e.id]).length} marked <span id="label-results">{JSON.stringify(results)}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${(big ?? 124) + 4}px)`, gap: 2 }}>
        {shown.map((e, i) => {
          const id = identify(e), m = marks[e.id]
          const toggle = (k: 'role' | 'category' | 'name') => set(e.id, { [k]: !(m?.[k] ?? true) })
          const btn = (k: 'role' | 'category' | 'name', text: string) => (
            <button onClick={() => toggle(k)} style={{ fontSize: 10, padding: '0 3px', marginRight: 2, background: m && !m[k] ? '#c33' : undefined }}>{text}</button>
          )
          return (
            <div key={e.id} data-id={e.id} style={{ border: '1px solid #555', padding: 2, fontSize: 10, lineHeight: 1.2, overflow: 'hidden', background: m ? (m.role && m.category && m.name ? '#1d3a24' : '#3a1d1d') : undefined }}>
              <Picture e={e} big={big} />
              <div><b>{page * per + i + 1}. {id.name}</b></div>
              <div>{btn('role', id.role)}{btn('category', id.category.split(' ')[0])}{btn('name', 'name')}{id.kind ? ' ' + id.kind : ''}</div>
              {id.building && <div>{id.building.footprint.join('×')}×{id.building.height} m · {id.building.storeys} st · front {id.building.front ?? '?'} · {id.building.districts?.join('/') ?? ''}</div>}
              <div style={{ opacity: 0.7, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={[e.name, ...(e.raw ?? []), ...e.tex, e.profile].join(' ')}>{e.name}{e.record < 0 ? '*' : ''} {e.size.map((v) => +v.toFixed(1)).join('×')} ×{e.seen}</div>
              <div style={{ opacity: 0.7, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{(e.raw ?? [])[0] ?? ''} {e.tex.slice(0, 2).join(' ')}</div>
            </div>
          )
        })}
      </div>
      <p>
        <a href={`?pool=${pool}&count=${count}&seed=${seed}&per=${per}&page=${Math.max(0, page - 1)}`}>← previous</a> · <a href={`?pool=${pool}&count=${count}&seed=${seed}&per=${per}&page=${page + 1}`}>next →</a>
        {' · '}<button onClick={() => { for (const e of shown) if (!marks[e.id]) set(e.id, {}) }}>Mark the rest of this page right</button>
      </p>
    </div>
  )
}

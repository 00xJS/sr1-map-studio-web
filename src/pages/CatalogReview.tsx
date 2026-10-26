// "Check game pieces" → Catalogue and Placeholders. The catalogue (lib/gameObjects/catalog.ts) breaks every model in
// the player's game library down: what it is to look at, how it is put together, its role, its measurements, how it
// stands, its material and where the game uses it, each with how sure the rules are and why. Filter by any of them,
// find the ones that need a look, and correct what's wrong (kept as the player's labels, which the wizard follows).
// Placeholders (placeholders.ts) set each of the site's own pieces beside the real models that can stand in for it.
import { useMemo, useState } from 'react'
import { catalogue, tally, withCorrections, type CatalogEntry, type Form, type Judged, type Structure } from '../lib/gameObjects/catalog'
import { placeholders } from '../lib/gameObjects/placeholders'
import { placementRules } from '../lib/gameObjects/placement'
import { setLabels, useGameLabels, withLabels, withPlacementLabels, type GameLabel } from '../lib/gameObjects/labels'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { PrefabThumb } from '../editor/PrefabThumb'

const PAGE = 48
export const FORMS: [Form, string][] = [['model', '3D model'], ['flat', 'Flat (decal, sign, poster)'], ['line', 'Line (wire, rail)'], ['invisible', 'Invisible or stand-in'], ['water', 'Water surface'], ['light', 'Light'], ['sky', 'Sky']]
export const STRUCTURES: [Structure, string][] = [['standalone', 'Standalone'], ['assembly', 'Comes with parts'], ['base', 'Base (others stand on it)'], ['top', 'Stands on a base'], ['part', 'Part of something bigger'], ['kit', 'Building kit piece'], ['connector', 'Connector (corner, end, post)'], ['copy', 'Copy or second state']]
const COVER: Record<string, string> = { none: 'No cover', crouch: 'Crouch cover', stand: 'Stand cover' }
type Side = 'form' | 'structure' | 'role' | 'cover'
const SIDES: [Side, string][] = [['form', 'Form'], ['structure', 'Structure'], ['role', 'Role'], ['cover', 'Cover']]
const NAME: Record<Side, (v: string) => string> = {
  form: (v) => FORMS.find(([k]) => k === v)?.[1] ?? v,
  structure: (v) => STRUCTURES.find(([k]) => k === v)?.[1] ?? v,
  role: (v) => v[0].toUpperCase() + v.slice(1),
  cover: (v) => COVER[v] ?? v,
}
/** Below this, a judgement is worth a look. */
const UNSURE = 0.6

const valueOf = (c: CatalogEntry, s: Side) => (s === 'cover' ? c.measures.cover.value : c[s].value)
const unsure = (c: CatalogEntry) => [c.form, c.structure, c.role, c.measures.cover].some((j) => j.sure < UNSURE)

/** The library catalogued, with the player's labels and placement corrections on top. */
export function useCatalogue(entries: GameObjectEntry[]) {
  const { labels, version } = useGameLabels()
  const rules = useMemo(() => placementRules(entries), [entries])
  return useMemo(() => {
    const ident = withLabels(labels)
    const rule = withPlacementLabels(labels, (e) => rules.get(e.id) ?? { attach: 'ground', mayVary: ['turn'] })
    const base = catalogue(entries, ident, rule, 'v' + version)
    const out = new Map<string, CatalogEntry>()
    for (const [id, c] of base) out.set(id, withCorrections(c, labels[id]))
    return out
  }, [entries, labels, version, rules])
}

export function CatalogView({ entries }: { entries: GameObjectEntry[] }) {
  const { labels } = useGameLabels()
  const cat = useCatalogue(entries)
  const [filter, setFilter] = useState<Partial<Record<Side, string>>>({})
  const [look, setLook] = useState(false)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const all = useMemo(() => [...cat.values()], [cat])
  const counts = useMemo(() => tally(all), [all])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((c) => (Object.entries(filter) as [Side, string][]).every(([s, v]) => valueOf(c, s) === v))
      .filter((c) => !look || unsure(c))
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle))
      // The most used first: what the game leans on most is what matters most to get right.
      .sort((a, b) => b.use.seen - a.use.seen || a.id.localeCompare(b.id))
  }, [all, filter, look, q])
  const pick = (s: Side, v: string) => { setFilter((f) => (f[s] === v ? { ...f, [s]: undefined } : { ...f, [s]: v })); setShown(PAGE) }
  const label = (id: string, l: GameLabel | null) => void setLabels({ [id]: l })
  return (
    <>
      <p className="muted small" style={{ margin: 0, maxWidth: 860 }}>
        Every model in your game library, broken down: what it is to look at, how it's put together, what it's for, how big and how solid it is,
        how it stands and where the game uses it. Bases (a lamp's foot, a fence post's footing) show every variation the game stands on them. Each answer says how sure it is and why (hover it). Pick values to filter; <b>Needs a look</b> shows
        the ones the rules are least sure of. Fix what's wrong: the wizard follows your corrections.
      </p>
      {SIDES.map(([s, name]) => (
        <div key={s} className="row wrap" style={{ gap: 4, alignItems: 'center' }}>
          <span className="small faint" style={{ minWidth: 70 }}>{name}</span>
          {Object.entries(counts[s]).sort((a, b) => b[1] - a[1]).map(([v, n]) => (
            <button key={v} className={'chip' + (filter[s] === v ? ' accent' : '')} onClick={() => pick(s, v)}>{NAME[s](v)} · {n.toLocaleString()}</button>
          ))}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        <input className="grow" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} style={{ maxWidth: 280 }} />
        <button className={'sm' + (look ? ' on' : '')} onClick={() => { setLook(!look); setShown(PAGE) }} title="Models where any answer is less than 60% sure">Needs a look</button>
        {(Object.values(filter).some(Boolean) || look || q) && <button className="sm quiet" onClick={() => { setFilter({}); setLook(false); setQ('') }}>Clear</button>}
        <span className="grow small muted">{list.length.toLocaleString()} of {all.length.toLocaleString()} models</span>
      </div>
      <div className="label-grid">
        {list.slice(0, shown).map((c) => <Row key={c.id} c={c} l={labels[c.id]} cat={cat} onLabel={(l) => label(c.id, l)} />)}
      </div>
      {list.length > shown && <button style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
    </>
  )
}

function Badge<T extends string>({ j, name }: { j: Judged<T>; name: string }) {
  return <span className={'chip' + (j.sure < UNSURE ? ' warn' : '')} title={`${j.why} (${Math.round(j.sure * 100)}% sure)`}>{name}</span>
}

function Row({ c, l, cat, onLabel }: { c: CatalogEntry; l?: GameLabel; cat: Map<string, CatalogEntry>; onLabel: (l: GameLabel | null) => void }) {
  const m = c.measures
  const nameOf = (id?: string) => (id ? cat.get(id)?.title ?? id : '')
  return (
    <div className={'label-tile' + (l?.ok ? ' ok' : l?.form || l?.structure ? ' fixed' : '')}>
      <PrefabThumb shape={'game:' + c.id} size={120} />
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        <b className="small">{c.title}</b>
        <span className="faint small mono" style={{ overflowWrap: 'anywhere' }}>{c.name}</span>
        <div className="row wrap" style={{ gap: 3 }}>
          <Badge j={c.form} name={NAME.form(c.form.value)} />
          <Badge j={c.structure} name={NAME.structure(c.structure.value)} />
          <Badge j={c.role} name={NAME.role(c.role.value)} />
          <Badge j={m.cover} name={NAME.cover(m.cover.value)} />
        </div>
        <span className="faint small">
          {m.long} × {m.short} m, {m.height} m tall · {m.footprint} m² · {m.triangles.toLocaleString()} tris
          {m.solid !== undefined ? ` · ${Math.round(m.solid * 100)}% solid at eye height` : ''}{m.standOn ? ' · can stand on it' : ''}
        </span>
        {c.stands && <span className="faint small" title="How the game stands it (placement rule)">Stands {c.stands.attach === 'ground' ? 'on the ground' : c.stands.attach === 'building' ? 'only on its building' : `on a ${c.stands.attach}`}{c.stands.facing ? `, facing ${c.stands.facing}` : ''}{c.stands.clearFront ? `, ${c.stands.clearFront} m clear in front` : ''}</span>}
        <span className="faint small">{c.material.surfaces.join(', ') || 'No surface'}{c.material.seeThrough ? ' · has see-through parts' : ''} · used {c.use.seen}×{c.use.maps.length ? ` · in ${c.use.maps.length} map${c.use.maps.length === 1 ? '' : 's'}` : ''}{c.use.districts.length ? ` · ${c.use.districts.slice(0, 3).join(', ')}` : ''}</span>
        {c.of && <span className="faint small">{c.structure.value === 'copy' ? 'Copy of' : c.structure.value === 'kit' ? 'Kit piece of' : 'Part of'}: {nameOf(c.of)}</span>}
        {c.parts && <span className="faint small" title={c.parts.map(nameOf).join(', ')}>Comes with: {c.parts.slice(0, 4).map(nameOf).join(', ')}{c.parts.length > 4 ? ` +${c.parts.length - 4}` : ''}</span>}
        {c.bases && <span className="faint small" title="What the game stands it on top of, and how often">Stands on: {c.bases.slice(0, 3).map((b) => `${nameOf(b.id)} (${b.n}×)`).join(', ')}</span>}
        {c.tops && (
          <div className="col" style={{ gap: 2 }}>
            <span className="faint small">{c.tops.length === 1 ? 'Stands on it:' : `${c.tops.length} variations stand on it:`}</span>
            <div className="row wrap" style={{ gap: 4 }}>
              {c.tops.slice(0, 6).map((t) => (
                <div key={t.id} className="col" style={{ gap: 0, width: 64 }} title={`${nameOf(t.id)}: on ${t.n} of its placements`}>
                  <PrefabThumb shape={'game:' + t.id} size={60} />
                  <span className="faint small" style={{ overflowWrap: 'anywhere', lineHeight: 1.1 }}>{nameOf(t.id)} · {t.n}×</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {c.use.near.length > 0 && <span className="faint small" title="What the game most often stands near it">Usually near: {c.use.near.slice(0, 3).map(nameOf).join(', ')}</span>}
        <div className="row wrap" style={{ gap: 4 }}>
          <button className={'sm' + (l?.ok ? ' on' : '')} title="All of this is right" onClick={() => onLabel(l?.ok ? { ...l, ok: undefined } : { ...l, ok: true })}>✓ Right</button>
          <select className="sm" value={l?.form ?? ''} title="What it really is to look at" onChange={(e) => onLabel({ ...l, ok: undefined, form: (e.target.value || undefined) as Form | undefined })}>
            <option value="">Form wrong?</option>
            {FORMS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          <select className="sm" value={l?.structure ?? ''} title="How it is really put together" onChange={(e) => onLabel({ ...l, ok: undefined, structure: (e.target.value || undefined) as Structure | undefined })}>
            <option value="">Structure wrong?</option>
            {STRUCTURES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          {l && <button className="sm quiet" title="Forget your corrections for this model" onClick={() => onLabel(null)}>Reset</button>}
        </div>
      </div>
    </div>
  )
}

export function PlaceholderView({ entries }: { entries: GameObjectEntry[] }) {
  const cat = useCatalogue(entries)
  const list = useMemo(() => placeholders(entries, cat, 4), [entries, cat])
  const missing = list.filter((p) => !p.matches.some((m) => m.named && m.off <= 1)).length
  return (
    <>
      <p className="muted small" style={{ margin: 0, maxWidth: 860 }}>
        The site's own pieces the wizard builds with (left), each with the real models from your game that can take its place, closest size first,
        and how far off each one's size is. <b>Same kind</b> means its name says it's the same thing. {missing} of {list.length} have no real piece of the same kind
        within twice their size yet: those are where the wizard still has to guess.
      </p>
      <div className="col" style={{ gap: 10 }}>
        {list.map((p) => (
          <div key={p.key} className="card" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
            <div className="col" style={{ gap: 3, width: 150 }}>
              <PrefabThumb shape={'prefab:' + p.key} size={120} />
              <b className="small">{p.label}</b>
              <span className="faint small">{p.size.long} × {p.size.short} m, {p.size.height} m tall</span>
              <span className="faint small">Stands for: {p.wants.join(', ')}</span>
            </div>
            {p.matches.length === 0 ? <span className="muted small">Nothing in your game library of this kind.</span> : p.matches.map((m) => (
              <div key={m.id} className="col" style={{ gap: 2, width: 140 }}>
                <PrefabThumb shape={'game:' + m.id} size={120} />
                <span className="small">{m.title}</span>
                <span className="faint small mono" style={{ overflowWrap: 'anywhere' }}>{m.name}</span>
                <span className="faint small">{m.long} × {m.short} × {m.height} m</span>
                <span className={'small ' + (m.off <= 0.25 ? 'ok' : m.off <= 0.6 ? 'muted' : 'warn')}>{m.off <= 0.05 ? 'Same size' : `${Math.round(m.off * 100)}% off in size`}{m.named ? ' · same kind' : ''}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

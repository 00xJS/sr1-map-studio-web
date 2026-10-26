// "Check game pieces": the models from the player's own game the map wizard builds with, best first for a setting,
// a group at a time. The player marks what is right and fixes what isn't (a light rig the rules call a building, a
// wall panel called a prop, the settings a model suits), and can measure how solid each building is at eye height.
// Further tabs (CityReview.tsx) show each model's placement rule and the city's groups and modules to check and
// correct. The labels stay in this browser (labels.ts); the wizard picks by them.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast, toastError } from '../ui'
import { SETTINGS, type WizardSetting } from '../lib/mapWizard'
import { NeedGameFolder, buildIndex, connect, getObject, loadIndex, useGameObjects } from '../lib/gameObjects/client'
import { identify, type GameRole, type PropKind } from '../lib/gameObjects/identity'
import { loadCityLabels, loadLabels, setLabels, useCityLabels, useGameLabels, withLabels, type GameLabel } from '../lib/gameObjects/labels'
import { placementOf } from '../lib/gameObjects/cityModules'
import { CityView, PlacementView } from './CityReview'
import { CatalogView, PlaceholderView } from './CatalogReview'
import { SOLID_COVER, gamePiecesSuit, prepare, type Cand } from '../lib/gameObjects/wizardPieces'
import { eyeCover } from '../lib/gameObjects/wizardBuild'
import { mapLimit } from '../lib/hubRules'
import type { GameObjectEntry } from '../lib/gameObjects/indexer'
import { PrefabThumb } from '../editor/PrefabThumb'
// Registers the pictures of game models (the "game:" thumbnails).
import '../editor/gameObjectActions'

type Group = 'building' | 'fence' | PropKind
const GROUPS: [Group, string][] = [
  ['building', 'Buildings'], ['cover', 'Cover'], ['clutter', 'Clutter'], ['street', 'Street furniture'], ['nature', 'Plants'], ['light', 'Lights'],
  ['vehicle', 'Wrecks and vehicles'], ['furniture', 'Furniture'], ['machine', 'Machines'], ['fence', 'Fences'],
]
const ROLES: [GameRole, string][] = [['building', 'A whole building'], ['prop', 'A prop'], ['fence', 'A fence or wall run'], ['piece', 'Part of a building'], ['ground', 'Ground or road'], ['skip', 'Never place it']]
const KINDS: PropKind[] = ['cover', 'clutter', 'street', 'nature', 'light', 'vehicle', 'sign', 'furniture', 'machine']
const SETTING_KEYS = (Object.keys(SETTINGS) as WizardSetting[]).filter(gamePiecesSuit)
const PAGE = 48
type Tab = 'pieces' | 'catalogue' | 'placeholders' | 'placement' | 'groups' | 'modules'
const TABS: [Tab, string][] = [['pieces', 'Wizard pieces'], ['catalogue', 'Catalogue'], ['placeholders', 'Placeholders'], ['placement', 'Placement rules'], ['groups', 'Groups'], ['modules', 'Modules']]

/** How solid a model is at eye height, cut out of the player's game (its shape only, no pictures). */
async function measure(e: GameObjectEntry): Promise<number> {
  const r = await getObject(e, 0)
  return +eyeCover({ positions: r.mesh.positions.map((v) => v * 2), faces: r.mesh.triangles }).toFixed(2)
}

export default function GamePiecesCheck() {
  const { entries, status, progress, connected } = useGameObjects()
  const { labels, version } = useGameLabels()
  const city = useCityLabels()
  const [tab, setTab] = useState<Tab>(() => { const t = new URLSearchParams(location.search).get('tab'); return TABS.some(([k]) => k === t) ? (t as Tab) : 'pieces' })
  const [setting, setSetting] = useState<WizardSetting>('downtown')
  const [group, setGroup] = useState<Group>('building')
  const [show, setShow] = useState<'all' | 'todo' | 'done'>('all')
  const [shown, setShown] = useState(PAGE)
  const [measuring, setMeasuring] = useState<{ done: number; total: number } | null>(null)
  // Models changed here stay in view (with their new label) until the page is left, so a change can be undone.
  const [touched, setTouched] = useState<string[]>([])
  useEffect(() => { void loadIndex().catch(() => {}); void loadLabels(); void loadCityLabels() }, [])
  useEffect(() => setShown(PAGE), [setting, group, show])

  const lib = useMemo(() => (entries ? prepare(entries, setting, identify, labels, version) : null), [entries, setting, labels, version])
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  const ident = useMemo(() => withLabels(labels), [labels])
  const list = useMemo(() => {
    if (!lib) return []
    const base: GameObjectEntry[] = (group === 'building' ? lib.buildings : group === 'fence' ? lib.fences : lib.props.get(group) ?? []).map((c: Cand) => c.e)
    const ids = new Set(base.map((e) => e.id))
    const kept = touched.map((id) => byId.get(id)).filter((e): e is GameObjectEntry => !!e && !ids.has(e.id) && wasIn(e, group))
    return [...kept, ...base].filter((e) => show === 'all' || (show === 'done') === isChecked(labels[e.id]))
    // Shown in the group it was in when changed.
    function wasIn(e: GameObjectEntry, g: Group) { const id = identify(e); return g === 'building' || g === 'fence' ? id.role === g : id.kind === g }
  }, [lib, group, show, labels, touched, byId])

  const checked = Object.values(labels).filter(isChecked).length
  const anyLabels = Object.keys(labels).length + Object.keys(city.groups).length + Object.keys(city.modules).length
  const label = (id: string, l: GameLabel | null) => {
    setTouched((t) => (t.includes(id) ? t : [id, ...t]))
    void setLabels({ [id]: l })
  }
  const openFiles = async () => {
    try { await connect(true) } catch (e) { toastError(e instanceof NeedGameFolder ? new Error('Choose your Saints Reborn folder to see the models.') : e) }
  }
  const measureAll = async () => {
    try { await connect(true) } catch (e) { toastError(e); return }
    // A chunk at a time, so each is read once.
    const todo = list.filter((e) => labels[e.id]?.cover === undefined).sort((a, b) => (a.pack + a.chunk).localeCompare(b.pack + b.chunk))
    setMeasuring({ done: 0, total: todo.length })
    let done = 0, open = 0
    const found: Record<string, GameLabel> = {}
    await mapLimit(todo, 3, async (e) => {
      try {
        const cover = await measure(e)
        found[e.id] = { ...labels[e.id], cover }
        if (cover < SOLID_COVER) open++
      } catch { /* left unmeasured */ }
      setMeasuring({ done: ++done, total: todo.length })
      // Kept as it goes, so leaving the page partway loses little.
      if (done % 25 === 0) void setLabels({ ...found })
    })
    await setLabels(found)
    setMeasuring(null)
    toast(`Measured ${Object.keys(found).length} buildings: ${open} can be seen through at eye height and won't be picked.`, 'info')
  }
  const download = () => {
    // Models (with the rules' answers next to the corrections), then the corrected groups and modules.
    const out: object[] = Object.entries(labels).map(([id, l]) => { const e = byId.get(id); return { type: 'model', id, name: e?.name, raw: e?.raw?.[0], cat: e?.cat, size: e?.size, rules: e ? identify(e).role : undefined, ...(e && l.place ? { placement: placementOf(e, byId) } : {}), ...l } })
    for (const [which, list] of [['group', city.groups], ['module', city.modules]] as const) for (const [id, l] of Object.entries(list)) out.push({ type: which, id, ...l })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }))
    a.download = 'game-piece-labels.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="page">
      <div className="col" style={{ gap: 6 }}>
        <h1 style={{ margin: 0 }}>Check game pieces</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 820 }}>
          The models from your own game that the <b>map wizard</b> builds with when you pick <b>🎮 Game pieces</b>, best first for a setting, how each
          one is placed, and the groups and pieces of Stilwater maps are built from. Mark the right ones, fix the wrong ones, and measure buildings to leave
          out the ones players could see through. Your labels stay in this browser and the wizard follows them straight away.
        </p>
      </div>
      {!entries ? (
        <div className="card col" style={{ gap: 8 }}>
          <span>{status === 'indexing' ? `Reading your game (${progress ? `${progress.done}/${progress.total || '…'}` : '…'})…` : 'Your game library isn\'t loaded in this browser yet.'}</span>
          {status !== 'indexing' && <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => buildIndex(true).catch(toastError)}>Load my game library</button>}
          <span className="faint small">It's read from your Saints Reborn folder on this device and never uploaded.</span>
        </div>
      ) : (
        <>
          <div className="row wrap">
            {TABS.map(([k, name]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); history.replaceState(null, '', k === 'pieces' ? location.pathname : `?tab=${k}`) }}>{name}</button>)}
            <span className="grow" />
            {!connected && <button className="sm" onClick={() => void openFiles()} title="The pictures are drawn from your game files">Show pictures</button>}
            <button className="sm quiet" disabled={!anyLabels} onClick={download} title="Your labels and corrections as a file (model names and sizes from your game, kept on your device)">Download my labels</button>
          </div>
          {tab === 'catalogue' && <div className="col" style={{ gap: 10 }} key={'cat' + (connected ? 'pictures' : 'none')}><CatalogView entries={entries} /></div>}
          {tab === 'placeholders' && <div className="col" style={{ gap: 10 }} key={'ph' + (connected ? 'pictures' : 'none')}><PlaceholderView entries={entries} /></div>}
          {tab === 'placement' && <div className="col" style={{ gap: 10 }} key={connected ? 'pictures' : 'none'}><PlacementView entries={entries} /></div>}
          {(tab === 'groups' || tab === 'modules') && <div className="col" style={{ gap: 10 }} key={tab + (connected ? 'pictures' : 'none')}><CityView which={tab} entries={entries} /></div>}
          {tab === 'pieces' && <>
          <div className="col" style={{ gap: 10 }}>
            <div className="row wrap">
              {SETTING_KEYS.map((k) => <button key={k} className={'sm' + (setting === k ? ' on' : '')} onClick={() => setSetting(k)}>{SETTINGS[k].icon} {SETTINGS[k].label}</button>)}
            </div>
            <div className="row wrap">
              {GROUPS.map(([g, name]) => <button key={g} className={'sm' + (group === g ? ' on' : '')} onClick={() => setGroup(g)}>{name}</button>)}
            </div>
            <div className="row wrap" style={{ alignItems: 'center' }}>
              {(['all', 'todo', 'done'] as const).map((k) => <button key={k} className={'sm quiet' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{{ all: 'All', todo: 'Not checked', done: 'Checked' }[k]}</button>)}
              <span className="grow small muted">{list.length} models · {checked} checked by you</span>
              {group === 'building' && <button className="sm" disabled={!!measuring} onClick={() => void measureAll()}
                title="Cuts out each building in the list and measures how much of it is solid at eye height; ones players could see through won't be picked">
                {measuring ? `Measuring ${measuring.done}/${measuring.total}…` : `Measure ${list.filter((e) => labels[e.id]?.cover === undefined).length} buildings`}</button>}
            </div>
          </div>
          {list.length === 0 ? <p className="muted">Nothing here for this setting.</p> : (
            // Drawn again once the game files are open (pictures asked for before then came back empty).
            <div className="label-grid" key={connected ? 'pictures' : 'none'}>
              {list.slice(0, shown).map((e) => <Tile key={e.id} e={e} id={ident(e)} rules={identify(e)} l={labels[e.id]} group={group} onLabel={(l) => label(e.id, l)} />)}
            </div>
          )}
          {list.length > shown && <button style={{ alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
          </>}
          <p className="faint small">Back to the <Link to="/">map wizard</Link> (Start a map → Map wizard → Build with: Game pieces).</p>
        </>
      )}
    </div>
  )
}

const isChecked = (l?: GameLabel) => !!l && (!!l.ok || !!l.role || !!l.kind || !!l.settings || !!l.place)

function Tile({ e, id, rules, l, group, onLabel }: { e: GameObjectEntry; id: ReturnType<typeof identify>; rules: ReturnType<typeof identify>; l?: GameLabel; group: Group; onLabel: (l: GameLabel | null) => void }) {
  const size = e.size.map((v) => +v.toFixed(1)).join(' × ')
  const wrongRole = l?.role && l.role !== rules.role
  const settings = id.settings
  const toggle = (s: WizardSetting) => onLabel({ ...l, settings: settings.includes(s) ? settings.filter((x) => x !== s) : [...settings, s] })
  return (
    <div className={'label-tile' + (l?.ok ? ' ok' : wrongRole || l?.kind ? ' fixed' : '')}>
      <PrefabThumb shape={'game:' + e.id} size={120} />
      <div className="col" style={{ gap: 3, minWidth: 0 }}>
        <b className="small" title={e.raw?.join(', ') || e.name}>{id.name}</b>
        <span className="faint small mono" style={{ overflowWrap: 'anywhere' }}>{e.name}</span>
        <span className="faint small">{size} m · {e.tris.toLocaleString()} tris{e.seen > 1 ? ` · used ${e.seen}×` : ''}</span>
        {l?.cover !== undefined && <span className={'small ' + (l.cover < SOLID_COVER ? 'warn' : 'muted')}>Solid at eye height: {Math.round(l.cover * 100)}%{l.cover < SOLID_COVER ? ' (see-through: not picked)' : ''}</span>}
        <div className="row wrap" style={{ gap: 4 }}>
          <button className={'sm' + (l?.ok ? ' on' : '')} title="Right as it is" onClick={() => onLabel(l?.ok ? { ...l, ok: undefined } : { ok: true, cover: l?.cover, settings: l?.settings })}>✓ Right</button>
          <select className="sm" value={l?.role ?? ''} title="What it really is" onChange={(ev) => onLabel({ ...l, ok: undefined, role: (ev.target.value || undefined) as GameRole | undefined })}>
            <option value="">{group === 'building' ? 'Not a building?' : 'Wrong?'}</option>
            {ROLES.map(([r, name]) => <option key={r} value={r}>{name}{r === rules.role ? ' (as the rules say)' : ''}</option>)}
          </select>
          {id.role === 'prop' && (
            <select className="sm" value={l?.kind ?? ''} title="What kind of prop" onChange={(ev) => onLabel({ ...l, kind: (ev.target.value || undefined) as PropKind | undefined })}>
              <option value="">Kind: {rules.kind ?? '—'}</option>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          {l && <button className="sm quiet" title="Forget your label for this model" onClick={() => onLabel(null)}>Reset</button>}
        </div>
        <div className="row wrap" style={{ gap: 3 }} title="The settings it suits (none: any)">
          {SETTING_KEYS.map((s) => <button key={s} className={'chip' + (settings.includes(s) ? ' accent' : '')} onClick={() => toggle(s)}>{SETTINGS[s].label}</button>)}
        </div>
      </div>
    </div>
  )
}

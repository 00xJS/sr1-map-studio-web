// The Game tab: how the map plays and looks in the game. Game modes, time and weather, background sound,
// loading screen, sky and minimap; the world settings (scale, mirroring, the spawn table) under More settings.
import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import * as act from '../actions'
import { getViewer } from '../Viewport'
import { More } from '../More'
import { GameFilesButton } from '../RetailMarkerFields'
import { Check, Field, FileButton, NumberInput, Status, infoDialog, toastError } from '../../ui'
import { statusSentence, triedInGame } from '../../lib/featureStatus'
import { minimapMode, minimapPad } from '../../lib/minimap'
import { AMBIENCE_OPTIONS, LOADING_SIZE, ambienceHint, loadingMode, type LoadingMode } from '../../lib/mapFeatures'
import { dataPackStatus, hasGroup, type DataPackStatus } from '../../lib/datapack'
import { db } from '../../lib/db'
import { GAME_MODES, baseName, dryInteriors, type ProjectSettings } from '../../lib/project'
import { checkModes, levelEntries, unusedModeMarkers } from '../../lib/levels'
import { MODE_HINTS } from '../../lib/labels'
import { MP_PACK } from '../../lib/gameFiles'
import { gameSkyAvailable, gameSkyWanted, SKY_SOURCE } from '../../lib/gameSky'
import { showsGameData } from '../../lib/gameObjects/policy'

const sanitize = (s: string) => s.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

function useSet() {
  const update = useEditor((s) => s.update)
  return <K extends keyof ProjectSettings>(label: string, k: K, v: ProjectSettings[K], merge = false) =>
    update(label, (d) => { d.settings[k] = v }, merge ? { merge: 'set-' + k } : undefined)
}

export function GameTab() {
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  useEffect(() => { dataPackStatus().then(setPack).catch(() => setPack(null)) }, [])
  return (
    <>
      <Modes />
      <Weather />
      <Sound />
      <div className="section">
        <span className="section-title">Loading screen <Status id="loading_screen" /></span>
        <LoadingSetting />
      </div>
      <Sky pack={pack} />
      <div className="section">
        <span className="section-title">Minimap</span>
        <MinimapSetting />
      </div>
      <More id="world" title="World settings">
        <World />
        <SurfaceSetting pack={pack} />
        <CtsSettings />
      </More>
    </>
  )
}

function Modes() {
  const project = useEditor((s) => s.project)!
  const set = useSet()
  const s = project.settings
  const modeCheck = checkModes(s, project.markers)
  const entries = levelEntries(sanitize(s.base_name) || 'map', s.modes, project.markers)
  return (
    <div className="section" id="game-modes">
      <span className="section-title">Game modes</span>
      {GAME_MODES.map((m) => (
        <Check key={m} checked={s.modes.includes(m)} onChange={(v) => set('Game modes', 'modes', GAME_MODES.filter((x) => (x === m ? v : s.modes.includes(x))))}>
          <span className="stack tight"><span>{m}</span><span className="faint small">{MODE_HINTS[m]}</span></span>
        </Check>
      ))}
      {modeCheck.errors.map((e) => <span key={e} className="small bad">{e}</span>)}
      {modeCheck.warnings.map((w) => {
        const unused = unusedModeMarkers(s.modes, project.markers).find((u) => u.text === w)
        return (
          <span key={w} className="small warn row wrap">
            <span className="grow">{w}</span>
            {unused && <button className="sm" onClick={() => act.removeMarkersOfType(unused.types)} title="Deletes them in one step; Undo brings them back">Remove {unused.count === 1 ? 'it' : `the ${unused.count}`}</button>}
          </span>
        )
      })}
      {entries.length > 0 && (
        <More id="levels" title="Spawn files and level IDs">
          <table className="mats">
            <thead><tr><th>Mode</th><th>Spawn file</th><th title="Unique across every installed map pack; stays the same while the file name and mode stay the same">Level ID</th><th title="Weapon and vehicle slots a Custom match can swap: the distinct types you placed (6 weapons when none)">Custom slots</th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.mode}><td>{e.mode}</td><td className="mono">{e.ctsFile}.cts</td><td className="mono">{e.id}</td><td>{e.weapons} weapon{e.weapons === 1 ? '' : 's'}, {e.vehicles} vehicle{e.vehicles === 1 ? '' : 's'}</td></tr>
            ))}</tbody>
          </table>
        </More>
      )}
    </div>
  )
}

function Weather() {
  const s = useEditor((st) => st.project!.settings)
  const set = useSet()
  return (
    <div className="section">
      <span className="section-title">Time and weather</span>
      <div className="row wrap">
        <button className={'sm' + (s.always_clear_weather ? ' on' : '')} aria-pressed={s.always_clear_weather} onClick={() => set('Time and weather', 'always_clear_weather', true)}>☀️ Always noon, clear</button>
        <button className={'sm' + (!s.always_clear_weather ? ' on' : '')} aria-pressed={!s.always_clear_weather} onClick={() => set('Time and weather', 'always_clear_weather', false)}>🌗 Changes each match</button>
      </div>
      <span className="faint small">{s.always_clear_weather
        ? 'Every match is at noon under a clear sky, like most custom maps.'
        : 'Like the retail maps: each match rolls noon, midnight, dusk or dawn and the weather.' + (triedInGame('random_weather') ? '' : ' Not yet tried on custom maps, so check how it looks at night.')}</span>
      {!s.always_clear_weather && (
        <Check checked={s.dry_interiors !== false} onChange={(v) => set('Keep interiors dry', 'dry_interiors', v)}
          title={'The export finds the floor that has a roof or ceiling over it and adds rain blockers there.' + statusSentence('dry_interiors')}>
          Keep interiors dry
        </Check>
      )}
      {dryInteriors(s) && <span className="small faint">No rain under roofs and ceilings. For a spot it misses, place a Rain blocker.</span>}
    </div>
  )
}

function Sound() {
  const ambience = useEditor((s) => s.project!.settings.ambience)
  const set = useSet()
  return (
    <div className="section">
      <span className="section-title">Background sound <Status id="ambience" /></span>
      <select value={ambience || ''} aria-label="Background sound" onChange={(e) => set('Background sound', 'ambience', e.target.value)}>
        <option value="">None</option>
        {AMBIENCE_OPTIONS.map((o) => <option key={o.file} value={o.file}>{o.label}</option>)}
      </select>
      <span className="faint small">{ambienceHint(ambience)}</span>
    </div>
  )
}

function Sky({ pack }: { pack: DataPackStatus | null }) {
  const s = useEditor((st) => st.project!.settings)
  const set = useSet()
  return (
    <div className="section">
      <span className="section-title">Sky</span>
      <GameSkySetting />
      <FileSetting label="Sky picture" hint={gameSkyWanted(s) ? "Used when the game's own sky can't be added. Blank = none." : 'Optional. Blank = no sky picture.'} k="sky_texture" accept="image/*,.tga,.dds" />
      <More id="sky" title="More sky settings">
        {s.sky_texture && <Field label="Sky picture size (0 = automatic)"><NumberInput value={s.sky_scale} step={0.5} min={0} max={100} onChange={(v) => set('Sky size', 'sky_scale', v)} /></Field>}
        <Field label="Native sky" hint={hasGroup(pack, 'sky') ? 'Stages the original sky resource pair with your map.' + statusSentence('native_sky') : 'Native sky presets are not in your data pack.'}>
          <select value={s.native_sky} disabled={!hasGroup(pack, 'sky')} onChange={(e) => set('Native sky', 'native_sky', e.target.value as ProjectSettings['native_sky'])}>
            <option value="">None</option>
            <option value="sr_alwayshwyf01">sr_alwayshwyf01 (Downtown / Factory)</option>
            <option value="sr_custom000001">sr_custom000001 (Seafood)</option>
          </select>
        </Field>
      </More>
    </div>
  )
}

function World() {
  const s = useEditor((st) => st.project!.settings)
  const set = useSet()
  return (
    <div className="section">
      <span className="section-title">World</span>
      <Field label="World scale" hint="Editor units to game metres. 0.50 (2 units = 1 m) is the tested default.">
        <NumberInput value={s.world_scale} step={0.05} min={0.01} max={10} onChange={(v) => set('World scale', 'world_scale', v)} />
      </Field>
      <Check checked={s.mirror_x} onChange={(v) => set('Mirror X', 'mirror_x', v)} title="Matches the Saints Reborn coordinate conversion. Turn off only for a model already in SR1 handedness.">Mirror X into SR1 space</Check>
      <Check checked={s.flip_obj_v} onChange={(v) => set('Flip texture V', 'flip_obj_v', v)} title="Fixes upside-down textures from direct OBJ/MTL imports.">Flip textures upside down (OBJ)</Check>
      <Check checked={s.double_sided} onChange={(v) => set('Show both sides', 'double_sided', v)} title="Exports reversed render-only copies of every triangle. Back sides get no extra collision.">Show both sides of every surface</Check>
      <FileSetting label="Native BBCity donor" hint="Optional .bbcity_xbox2 from your game for native city metadata. Stays on this device." k="bbcity_donor" accept=".bbcity_xbox2" />
    </div>
  )
}

/** v1.15's early surface registration (py/surface_registration.py): footsteps and bullet impacts follow each texture's surface. */
function SurfaceSetting({ pack }: { pack: DataPackStatus | null }) {
  const s = useEditor((st) => st.project!.settings)
  const update = useEditor((st) => st.update)
  const ready = hasGroup(pack, 'surface') && hasGroup(pack, 'sky')
  return (
    <div className="section">
      <span className="section-title">Surfaces <Status id="surface_registration" /></span>
      <Check checked={!!s.surface_preload} disabled={!ready && !s.surface_preload} onChange={(v) => update('Export setting', (d) => { d.settings.surface_preload = v })}
        title="Copies the map's textures into an extra environment file pair that the game loads before the map, so each texture's surface (Wood, Metal, Grass…) decides its footsteps and bullet impacts. Uses a full-size city file.">
        Register surface impacts early
      </Check>
      <span className="faint small">
        {!ready && !s.surface_preload
          ? 'Needs the surface template and the native sky presets in your data pack.'
          : s.surface_preload
            ? `Adds two sf_… files to the map's levels folder (${s.native_sky === 'sr_alwayshwyf01' ? 'about 40' : 'about 60'} MB: the stock ${s.native_sky || 'sr_custom000001'} sky with copies of your textures); install them with the map. Map file names: 10 characters at most. The game's own sky option steps aside: this brings its sky.${statusSentence('surface_registration')}`
            : "Off: textures keep their surface names, but the game may read them before they load and treat every surface as concrete."}
      </span>
    </div>
  )
}

/** The game's own sky, read from the player's game files at export (src/lib/gameSky.ts). */
function GameSkySetting() {
  const s = useEditor((st) => st.project!.settings)
  const update = useEditor((st) => st.update)
  const [ready, setReady] = useState<boolean | null>(null)
  const check = () => gameSkyAvailable().then(setReady).catch(() => setReady(false))
  useEffect(() => { void check() }, [])
  const on = gameSkyWanted(s)
  return (
    <div className="stack tight">
      <Check checked={s.game_sky !== false} disabled={!!s.native_sky || !!s.surface_preload} onChange={(v) => update('Game sky', (d) => { d.settings.game_sky = v })}
        title={`Copies the sky of the game's ${SKY_SOURCE} map into yours at export: clouds, sun, moon and stars that follow the time of day. Read from your own game files; nothing is uploaded.`}>
        The game's own sky (clouds, sun, moon, stars)
      </Check>
      {s.native_sky || s.surface_preload
        ? <span className="faint small">Off while {s.native_sky ? 'a native sky preset is chosen: the preset' : 'early surface registration is on: its environment'} brings its own sky.</span>
        : on && ready === true ? <span className="faint small">Read from {MP_PACK} in your game at export.{statusSentence('game_sky')}</span>
        : on && ready === false ? (
          <>
            <span className="faint small">Needs your Saints Reborn folder at export; without it the sky picture is used.</span>
            <GameFilesButton pack={MP_PACK} what="sky" onReady={check} />
          </>
        ) : null}
    </div>
  )
}

/** Automatic minimap (rendered from above at every export) or the user's own image. */
function MinimapSetting() {
  const project = useEditor((s) => s.project!)
  const update = useEditor((s) => s.update)
  const mode = minimapMode(project)
  const [busy, setBusy] = useState(false)
  const preview = async () => {
    const v = getViewer()
    if (!v) return
    setBusy(true)
    try {
      const rect = v.minimapRect(minimapPad(project))
      const blob = rect && await v.captureTopDown({ size: 512, rect, mirror: !project.settings.mirror_x })
      if (blob) await infoDialog('Minimap preview', <img className="preview-img" src={URL.createObjectURL(blob)} alt="Minimap preview" />)
    } finally { setBusy(false) }
  }
  return (
    <div className="stack tight">
      <div className="row wrap">
        <button className={'sm' + (mode === 'auto' ? ' on' : '')} aria-pressed={mode === 'auto'} onClick={() => update('Minimap', (d) => { d.settings.minimap_mode = 'auto' })}>Automatic</button>
        <button className={'sm' + (mode === 'custom' ? ' on' : '')} aria-pressed={mode === 'custom'} onClick={() => update('Minimap', (d) => { d.settings.minimap_mode = 'custom' })}>My image</button>
        {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={preview}>Preview</button>}
      </div>
      <span className="faint small">{mode === 'auto' ? 'Drawn from straight above every time you build the map, so it always matches it.' : 'Your own top-down image, square, 1024×1024 recommended. It is stretched over the whole map plus a 3 m border, north up.'}</span>
      {mode === 'custom' && <FileSetting label="Minimap image" hint="Top-down, north up." k="minimap_texture" accept="image/*,.tga,.dds" />}
    </div>
  )
}

/** Picture shown while the map loads: the 3D view rendered at export, the user's own, or none. */
export function LoadingSetting() {
  const project = useEditor((s) => s.project!)
  const update = useEditor((s) => s.update)
  const mode = loadingMode(project)
  const [busy, setBusy] = useState(false)
  const preview = async () => {
    const v = getViewer()
    if (!v) return
    setBusy(true)
    try {
      const blob = await v.capture(LOADING_SIZE[0], LOADING_SIZE[1])
      if (blob) await infoDialog('Loading screen preview', <img className="preview-img" src={URL.createObjectURL(blob)} alt="Loading screen preview" />)
    } finally { setBusy(false) }
  }
  const pick = (m: LoadingMode) => update('Loading screen', (d) => { d.settings.loading_mode = m })
  // The shot as it is now becomes the map's own picture, so the loading screen no longer depends on the view at export.
  const keep = async () => {
    const v = getViewer()
    if (!v) return
    setBusy(true)
    try {
      const blob = await v.capture(LOADING_SIZE[0], LOADING_SIZE[1])
      if (!blob) return
      // A view of game objects or built dummies is game data: it stays on this device (never uploaded or shared).
      const p = useEditor.getState().project
      await act.setProjectFile('loading_image', new File([blob], 'loading_screen.png', { type: 'image/png' }), (!!p && showsGameData(p)) || v.drawsGameData())
      pick('custom')
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="stack tight">
      <div className="row wrap">
        <button className={'sm' + (mode === 'auto' ? ' on' : '')} aria-pressed={mode === 'auto'} onClick={() => pick('auto')}>3D view</button>
        <button className={'sm' + (mode === 'custom' ? ' on' : '')} aria-pressed={mode === 'custom'} onClick={() => pick('custom')}>My picture</button>
        <button className={'sm' + (mode === 'none' ? ' on' : '')} aria-pressed={mode === 'none'} onClick={() => pick('none')}>None</button>
        {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={preview}>Preview</button>}
        {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={keep} title="Use the view as it is now as this map's loading picture">Keep this view</button>}
      </div>
      <span className="faint small">{mode === 'auto'
        ? 'The 3D view as it is when you build the map, at 1280×720. Frame a good shot first.'
        : mode === 'custom' ? 'Your own picture, cropped to 16:9 around its middle and sized to 1280×720.' : 'No picture while the map loads, like other custom maps.'}</span>
      {mode === 'custom' && <FileSetting label="Loading picture" hint="16:9 looks best, for example 1280×720 or 1920×1080." k="loading_image" accept="image/*,.tga,.dds" />}
    </div>
  )
}

function FileSetting({ label, hint, k, accept }: { label: string; hint: string; k: 'sky_texture' | 'minimap_texture' | 'bbcity_donor' | 'loading_image'; accept: string }) {
  const value = useEditor((s) => s.project!.settings[k])
  return (
    <Field label={label} hint={hint}>
      <div className="row">
        <span className={'grow small ellipsis ' + (value ? '' : 'faint')}>{value ? baseName(value) : 'None'}</span>
        <FileButton className="sm" accept={accept} onFiles={([f]) => act.setProjectFile(k, f).catch(toastError)}>Choose…</FileButton>
        {value && <button className="sm quiet" onClick={() => act.setProjectFile(k, null)}>Clear</button>}
      </div>
    </Field>
  )
}

/** The map's spawn table (CTS): a template to build on, and whether markers are in game coordinates. */
function CtsSettings() {
  const s = useEditor((st) => st.project!.settings)
  const update = useEditor((st) => st.update)
  const [templates, setTemplates] = useState<string[]>([])
  useEffect(() => { db.listDataPack().then((p) => setTemplates(p.filter((x) => x.startsWith('cts_examples/')))).catch(() => setTemplates([])) }, [])
  const own = s.cts_template && !s.cts_template.startsWith('/studio/')
  return (
    <div className="section">
      <span className="section-title">Spawn table (CTS)</span>
      <Check checked={s.marker_game_coords} onChange={(v) => update('Marker coordinates', (d) => { d.settings.marker_game_coords = v })}>Marker positions are already SR1 game coordinates</Check>
      <Field label="Template" hint="Optional. New markers are added to a copy; other gameplay content stays as it is. Blank uses the exporter's default.">
        <select value={own ? 'own' : s.cts_template} onChange={(e) => { if (e.target.value !== 'own') update('CTS template', (d) => { d.settings.cts_template = e.target.value }) }}>
          <option value="">Default (none)</option>
          {templates.map((t) => <option key={t} value={'/studio/' + t}>{baseName(t)} (data pack)</option>)}
          {own && <option value="own">{baseName(s.cts_template)} (your file)</option>}
        </select>
      </Field>
      <FileButton className="sm start" accept=".cts" onFiles={([f]) => act.setProjectFile('cts_template', f)}>Use a CTS from my game…</FileButton>
      <span className="faint small">Marker positions are centred and grounded exactly like the built map. Facing still needs checking in game.</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEditor } from '../store'
import { useExport } from '../useExport'
import { ExportProgressBar } from '../ExportProgressBar'
import * as act from '../actions'
import { Check, Field, FileButton, NumberInput, Status, infoDialog, toastError } from '../../ui'
import { statusSentence, triedInGame } from '../../lib/featureStatus'
import { minimapMode, minimapPad } from '../../lib/minimap'
import { AMBIENCE_OPTIONS, LOADING_SIZE, ambienceHint, loadingMode, type LoadingMode } from '../../lib/mapFeatures'
import { getViewer } from '../Viewport'
import { dataPackStatus, hasGroup, type DataPackStatus } from '../../lib/datapack'
import { downloadBlob } from '../../lib/exporter'
import { GAME_MODES, SPAWN_TYPES, baseName, dryInteriors, maxMapName, type ProjectSettings } from '../../lib/project'
import { checkModes, levelEntries, unusedModeMarkers } from '../../lib/levels'
import { installSupported } from '../../lib/install'
import { MP_PACK } from '../../lib/gameFiles'
import { gameSkyAvailable, gameSkyWanted, SKY_SOURCE } from '../../lib/gameSky'
import { GameFilesButton } from '../RetailMarkerFields'

const sanitize = (s: string) => s.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

export function ExportPanel() {
  const project = useEditor((s) => s.project)!
  const update = useEditor((s) => s.update)
  const s = project.settings
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const exp = useExport()
  const { busy, result, error, mapsDir, progress } = exp
  useEffect(() => { dataPackStatus().then(setPack) }, [])
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K], merge = false) =>
    update('Export setting', (d) => { d.settings[k] = v }, merge ? { merge: 'set-' + k } : undefined)

  const name = sanitize(s.base_name)
  const maxName = maxMapName(s)
  const nameError = !name ? 'Enter a map file name.'
    : name.length > maxName ? `Map file names must be ${maxName} characters or fewer${s.surface_preload ? ' with early surface registration' : ''}.` : ''
  const spawns = project.markers.filter((m) => SPAWN_TYPES.includes(m.type)).length
  const problems = [
    !project.scene_items.length && 'Load a base map.',
    !spawns && 'Place at least one spawn in the Spawns tab.',
    nameError,
    pack && !pack.ready && 'Your data pack is missing the map template.',
    s.surface_preload && pack && !(hasGroup(pack, 'surface') && hasGroup(pack, 'sky')) && 'Early surface registration needs the surface template and the native sky presets from your data pack.',
  ].filter(Boolean) as string[]
  const modeCheck = checkModes(s, project.markers)
  problems.push(...modeCheck.errors)
  const entries = levelEntries(name || 'map', s.modes, project.markers)

  const exportNow = (target: 'install' | 'download', chooseFolder = false) => exp.run(target, chooseFolder)

  return (
    <>
      {pack && !pack.ready && (
        <div className="callout warn"><div className="col"><b>Data pack needed to export</b><span className="small">The exporter builds on the map template from your own SR1 Map Studio package. It stays in this browser and is never uploaded. <Link to="/setup">Set up data pack</Link></span></div></div>
      )}
      <div className="group">
        <span className="section-title">Map</span>
        <div className="form-grid">
          <Field label={`File name (max ${maxName})`} hint={nameError || `Files: ${name || '…'}.bbchunk_xbox2 …`}>
            <input value={s.base_name} maxLength={11} onChange={(e) => set('base_name', e.target.value, true)} />
          </Field>
          <Field label="Display name" hint="Shown in the game's map list.">
            <input value={s.display_name} maxLength={40} onChange={(e) => set('display_name', e.target.value, true)} />
          </Field>
        </div>
        <Field label="Description" hint={"The map's help text in the game's menus, written for every game language. One paragraph; blank gives a short default." + statusSentence('map_description')}>
          <textarea rows={2} maxLength={400} value={project.description} onChange={(e) => update('Description', (d) => { d.description = e.target.value }, { merge: 'description' })} />
        </Field>
        <span className="small muted">Game modes</span>
        <div className="row wrap">
          {GAME_MODES.map((m) => (
            <Check key={m} checked={s.modes.includes(m)} onChange={(v) => set('modes', GAME_MODES.filter((x) => (x === m ? v : s.modes.includes(x))))}>{m}</Check>
          ))}
        </div>
        {modeCheck.warnings.map((w) => {
          const unused = unusedModeMarkers(s.modes, project.markers).find((u) => u.text === w)
          return (
            <span key={w} className="small warn row wrap" style={{ gap: 8 }}>
              <span className="grow">{w}</span>
              {unused && <button className="sm" onClick={() => act.removeMarkersOfType(unused.types)} title="Deletes them in one step; Undo brings them back">Remove {unused.count === 1 ? 'it' : `the ${unused.count}`}</button>}
            </span>
          )
        })}
        {entries.length > 0 && (
          <table className="mats" style={{ marginTop: 4 }}>
            <thead><tr><th>Mode</th><th>Spawn file</th><th title="Unique across every installed map pack; stays the same while the file name and mode stay the same">Level ID</th><th title="Weapon and vehicle slots a Custom match can swap: the distinct types you placed (6 weapons when none)">Custom slots</th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.mode}><td>{e.mode}</td><td className="mono">{e.ctsFile}.cts</td><td className="mono">{e.id}</td><td>{e.weapons} weapon{e.weapons === 1 ? '' : 's'}, {e.vehicles} vehicle{e.vehicles === 1 ? '' : 's'}</td></tr>
            ))}</tbody>
          </table>
        )}
        <Check checked={s.always_clear_weather} onChange={(v) => set('always_clear_weather', v)}
          title={"On: every match is noon with clear skies (what all custom maps do today). Off: the game rolls the time of day and weather each match, like retail maps." + statusSentence('random_weather')}>
          Always clear weather (noon, clear skies)
        </Check>
        {!s.always_clear_weather && <span className="small muted">Each match gets a random time (noon, midnight, dusk or dawn) and weather.{triedInGame('random_weather') ? '' : ' Untested on custom maps: check your sky and lighting at night.'}</span>}
        {!s.always_clear_weather && (
          <Check checked={s.dry_interiors !== false} onChange={(v) => set('dry_interiors', v)}
            title={'The export finds the floor that has a roof or ceiling over it and adds rain blockers there.' + statusSentence('dry_interiors')}>
            Keep interiors dry
          </Check>
        )}
        {dryInteriors(s) && <span className="small muted">Interiors are kept dry: no rain under roofs and ceilings. For a spot it misses, place a Rain blocker.</span>}
      </div>

      <SurfaceSetting pack={pack} />

      <div className="group">
        <span className="section-title">World</span>
        <div className="form-grid">
          <Field label="World scale" hint="Uniform model-to-SR1 scale. 0.50 is the tested default.">
            <NumberInput value={s.world_scale} step={0.05} min={0.01} max={10} onChange={(v) => set('world_scale', v)} />
          </Field>
          <div className="col">
            <Check checked={s.mirror_x} onChange={(v) => set('mirror_x', v)} title="Matches the Saints Reborn coordinate conversion. Turn off only for a model already in SR1 handedness.">Mirror X into SR1 space</Check>
            <Check checked={s.flip_obj_v} onChange={(v) => set('flip_obj_v', v)} title="Fixes upside-down textures from direct OBJ/MTL imports.">Flip texture V</Check>
            <Check checked={s.double_sided} onChange={(v) => set('double_sided', v)} title="Exports reversed render-only copies of every triangle. Back sides get no extra collision.">Two-sided everything</Check>
            <Check checked={s.remove_invisible_walls !== false} onChange={(v) => set('remove_invisible_walls', v)} title="Leaves paper-thin triangles out of the collision. They draw nothing, but in game they act as invisible walls that block players and push the camera from open air (common on converted and rescaled maps).">Remove invisible walls</Check>
          </div>
        </div>
      </div>

      <div className="group">
        <span className="section-title">Sky &amp; minimap</span>
        <GameSkySetting />
        <Field label="Native sky" hint={hasGroup(pack, 'sky') ? 'Stages the original sky resource pair with your map.' + statusSentence('native_sky') : 'Native sky presets are not in your data pack.'}>
          <select value={s.native_sky} disabled={!hasGroup(pack, 'sky')} onChange={(e) => set('native_sky', e.target.value as ProjectSettings['native_sky'])}>
            <option value="">None</option>
            <option value="sr_alwayshwyf01">sr_alwayshwyf01 (Downtown / Factory)</option>
            <option value="sr_custom000001">sr_custom000001 (Seafood)</option>
          </select>
        </Field>
        <FileSetting label="Fake sky image" hint={gameSkyWanted(s) ? "Used when the game's own sky can't be added. Blank = none." : 'Optional. Blank = no fake skybox.'} k="sky_texture" accept="image/*,.tga,.dds" />
        {s.sky_texture && <Field label="Skybox size (0 = auto)"><NumberInput value={s.sky_scale} step={0.5} min={0} max={100} onChange={(v) => set('sky_scale', v)} /></Field>}
        <MinimapSetting />
        <FileSetting label="Native BBCity donor (advanced)" hint="Optional .bbcity_xbox2 from your game for native city metadata. Stays on this device." k="bbcity_donor" accept=".bbcity_xbox2" />
      </div>

      <div className="group">
        <span className="section-title">Loading screen &amp; sound <Status id="loading_screen" /></span>
        <LoadingSetting />
        <Field label="Background sound" hint={ambienceHint(s.ambience)}>
          <select value={s.ambience || ''} onChange={(e) => set('ambience', e.target.value)}>
            <option value="">None</option>
            {AMBIENCE_OPTIONS.map((o) => <option key={o.file} value={o.file}>{o.label}</option>)}
          </select>
        </Field>
      </div>

      {problems.length > 0 && <div className="callout bad"><div className="col">{problems.map((p) => <span key={p}>{p}</span>)}</div></div>}
      {installSupported() ? (
        <div className="col">
          <button className="primary" style={{ padding: '10px' }} disabled={busy || problems.length > 0} onClick={() => exportNow('install')}>
            {busy ? 'Exporting… (see build log)' : 'Export and install to game →'}
          </button>
          <div className="row wrap">
            <span className="faint small grow">{mapsDir ? <>Installs into your <code>{mapsDir}</code> folder.</> : <>The first time, choose <code>SaintsReborn/dist/maps</code> (or the SaintsReborn folder).</>}</span>
            {mapsDir && <button className="sm quiet" disabled={busy || problems.length > 0} onClick={() => exportNow('install', true)}>Change folder</button>}
            <button className="sm" disabled={busy || problems.length > 0} onClick={() => exportNow('download')}>Download zip instead</button>
          </div>
        </div>
      ) : (
        <button className="primary" style={{ padding: '10px' }} disabled={busy || problems.length > 0} onClick={() => exportNow('download')}>
          {busy ? 'Exporting… (see build log)' : 'Export Saints Row map →'}
        </button>
      )}
      {busy && <ExportProgressBar progress={progress} />}
      {error && <div className="callout bad"><pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }} className="small mono">{error}</pre></div>}
      {result && (
        <div className="callout ok">
          <div className="col">
            <b>Export complete</b>
            <span className="small">Render: {result.r.summary.render_triangles?.toLocaleString()} triangles in {result.r.summary.render_meshes} mesh(es), {result.r.summary.material_batches} material batches.</span>
            <span className="small">Collision: {result.r.summary.collision_triangles?.toLocaleString()}/{result.r.summary.source_triangles?.toLocaleString()} source triangles. Native objects: {result.r.summary.native_objects}. Lights: {result.r.summary.lights}.</span>
            <span className="small">{result.installedTo
              ? <>Installed to <code>{result.installedTo}</code>. Start (or restart) the game and look for it in a private party.</>
              : <>Unzip <b>{result.folder}</b> into <code>SaintsReborn/dist/maps</code>, then start the game.</>}</span>
            <div className="row"><button className="sm" onClick={async () => downloadBlob(await result.zip(), `${result.folder}.zip`)}>Download again</button></div>
          </div>
        </div>
      )}
      <p className="faint small">Export runs entirely in your browser using the original SR1 Map Studio exporter (Python, in WebAssembly). Nothing is uploaded.</p>
    </>
  )
}

/** v1.15's early surface registration (py/surface_registration.py): footsteps and bullet impacts follow each texture's surface. */
function SurfaceSetting({ pack }: { pack: DataPackStatus | null }) {
  const s = useEditor((st) => st.project!.settings)
  const update = useEditor((st) => st.update)
  const ready = hasGroup(pack, 'surface') && hasGroup(pack, 'sky')
  return (
    <div className="group">
      <span className="section-title">Surfaces <Status id="surface_registration" /></span>
      <Check checked={!!s.surface_preload} disabled={!ready && !s.surface_preload} onChange={(v) => update('Export setting', (d) => { d.settings.surface_preload = v })}
        title="Copies the map's textures into an extra environment file pair that the game loads before the map, so each texture's surface (Materials: Wood, Metal, Grass…) decides its footsteps and bullet impacts. Uses a full-size city file.">
        Register surface impacts early
      </Check>
      <span className="faint small">
        {!ready && !s.surface_preload
          ? 'Needs the surface template and the native sky presets in your data pack (Data pack page).'
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
  const check = () => gameSkyAvailable().then(setReady)
  useEffect(() => { check() }, [])
  const on = gameSkyWanted(s)
  return (
    <div className="col">
      <Check checked={s.game_sky !== false} disabled={!!s.native_sky || !!s.surface_preload} onChange={(v) => update('Export setting', (d) => { d.settings.game_sky = v })}
        title={`Copies the sky of the game's ${SKY_SOURCE} map into yours at export: clouds, sun, moon and stars that follow the time of day. Read from your own game files; nothing is uploaded.`}>
        The game's own sky (clouds, sun, moon, stars)
      </Check>
      {s.native_sky || s.surface_preload
        ? <span className="faint small">Off while {s.native_sky ? 'a native sky preset is chosen: the preset' : 'early surface registration is on: its environment'} brings its own sky.</span>
        : on && ready === true ? <span className="faint small">Read from {MP_PACK} in your game at export.{statusSentence('game_sky')}</span>
        : on && ready === false ? (
          <>
            <span className="faint small">Needs your Saints Reborn folder at export; without it the fake sky image is used.</span>
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
      if (blob) await infoDialog('Minimap preview', <img src={URL.createObjectURL(blob)} alt="Minimap preview" style={{ width: '100%', borderRadius: 6 }} />)
    } finally { setBusy(false) }
  }
  return (
    <Field label="Minimap" hint={mode === 'auto' ? 'Rendered from straight above every time you export, so it always matches the map.' : 'Your own top-down image, square, 1024×1024 recommended. It is stretched over the whole map plus a 3 m border, north up.'}>
      <div className="col">
        <div className="row wrap">
          <button className={'sm' + (mode === 'auto' ? ' on' : '')} onClick={() => update('Minimap', (d) => { d.settings.minimap_mode = 'auto' })}>Automatic</button>
          <button className={'sm' + (mode === 'custom' ? ' on' : '')} onClick={() => update('Minimap', (d) => { d.settings.minimap_mode = 'custom' })}>My image</button>
          {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={preview}>Preview</button>}
        </div>
        {mode === 'custom' && <FileSetting label="Minimap image" hint="Top-down, north up." k="minimap_texture" accept="image/*,.tga,.dds" />}
      </div>
    </Field>
  )
}

/** Picture shown while the map loads: the 3D view rendered at export, the user's own, or none. */
/** How the map's loading screen is made: shown in the Export tab and, for Simple mode, in "Your map". */
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
      if (blob) await infoDialog('Loading screen preview', <img src={URL.createObjectURL(blob)} alt="Loading screen preview" style={{ width: '100%', borderRadius: 6 }} />)
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
      await act.setProjectFile('loading_image', new File([blob], 'loading_screen.png', { type: 'image/png' }))
      pick('custom')
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <Field label="Loading screen" hint={mode === 'auto'
      ? 'The 3D view as it is when you export, at 1280×720. Frame a good shot first.'
      : mode === 'custom' ? 'Your own picture, cropped to 16:9 around its middle and sized to 1280×720.' : 'No picture while the map loads, like other custom maps.'}>
      <div className="col">
        <div className="row wrap">
          <button className={'sm' + (mode === 'auto' ? ' on' : '')} onClick={() => pick('auto')}>3D view</button>
          <button className={'sm' + (mode === 'custom' ? ' on' : '')} onClick={() => pick('custom')}>My picture</button>
          <button className={'sm' + (mode === 'none' ? ' on' : '')} onClick={() => pick('none')}>None</button>
          {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={preview}>Preview</button>}
          {mode === 'auto' && <button className="sm quiet" disabled={busy} onClick={keep} title="Use the view as it is now as this map's loading picture">Keep this view</button>}
        </div>
        {mode === 'custom' && <FileSetting label="Loading picture" hint="16:9 looks best, for example 1280×720 or 1920×1080." k="loading_image" accept="image/*,.tga,.dds" />}
      </div>
    </Field>
  )
}

function FileSetting({ label, hint, k, accept }: { label: string; hint: string; k: 'sky_texture' | 'minimap_texture' | 'bbcity_donor' | 'loading_image'; accept: string }) {
  const value = useEditor((s) => s.project!.settings[k])
  return (
    <Field label={label} hint={hint}>
      <div className="row">
        <span className={'grow small ' + (value ? '' : 'faint')} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value ? baseName(value) : 'None'}</span>
        <FileButton className="sm" accept={accept} onFiles={([f]) => act.setProjectFile(k, f).catch(toastError)}>Choose…</FileButton>
        {value && <button className="sm quiet" onClick={() => act.setProjectFile(k, null)}>Clear</button>}
      </div>
    </Field>
  )
}

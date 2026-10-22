import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEditor, saveNow } from '../store'
import * as act from '../actions'
import { Check, Field, FileButton, NumberInput, confirmDialog, toastError } from '../../ui'
import { dataPackStatus, hasGroup, type DataPackStatus } from '../../lib/datapack'
import { downloadBlob, runExport, type ExportResult } from '../../lib/exporter'
import { GAME_MODES, SPAWN_TYPES, baseName, type ProjectSettings } from '../../lib/project'
import { checkModes, levelEntries } from '../../lib/levels'
import { installSupported, mapFolderExists, mapsFolder, rememberedMapsFolder, writeMap } from '../../lib/install'

const sanitize = (s: string) => s.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

export function ExportPanel() {
  const project = useEditor((s) => s.project)!
  const update = useEditor((s) => s.update)
  const s = project.settings
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ r: ExportResult; zip: Blob; folder: string; installedTo?: string } | null>(null)
  const [error, setError] = useState('')
  const [mapsDir, setMapsDir] = useState<string | null>(null)
  useEffect(() => { dataPackStatus().then(setPack); rememberedMapsFolder().then(setMapsDir) }, [])
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K], merge = false) =>
    update('Export setting', (d) => { d.settings[k] = v }, merge ? { merge: 'set-' + k } : undefined)

  const name = sanitize(s.base_name)
  const nameError = !name ? 'Enter a map file name.' : name.length > 11 ? 'Map file names must be 11 characters or fewer.' : ''
  const spawns = project.markers.filter((m) => SPAWN_TYPES.includes(m.type)).length
  const problems = [
    !project.scene_items.length && 'Load a base map.',
    !spawns && 'Place at least one spawn in the Spawns tab.',
    nameError,
    pack && !pack.ready && 'Your data pack is missing the map template.',
  ].filter(Boolean) as string[]
  const modeCheck = checkModes(s, project.markers)
  problems.push(...modeCheck.errors)
  const entries = levelEntries(name || 'map', s.modes, project.markers)

  const exportNow = async (target: 'install' | 'download', chooseFolder = false) => {
    setError(''); setResult(null)
    const log = useEditor.getState().log
    try {
      // Ask for the folder first: browsers only show folder pickers right after a click.
      const maps = target === 'install' ? await mapsFolder(chooseFolder) : null
      if (maps) setMapsDir(maps.name)
      setBusy(true)
      await saveNow()
      const out = await runExport(project, log)
      log(`Export complete: ${out.result.files.length} map files.`)
      if (maps) {
        if (await mapFolderExists(maps, out.folder) && !(await confirmDialog('Replace installed map?', `maps/${out.folder} already exists. Its files will be replaced with this export.`, { confirm: 'Replace' }))) {
          setResult({ r: out.result, zip: out.zip, folder: out.folder })
          return
        }
        const n = await writeMap(maps, out.entries)
        log(`Installed ${n} files to maps/${out.folder}.`)
        setResult({ r: out.result, zip: out.zip, folder: out.folder, installedTo: `${maps.name}/${out.folder}` })
      } else {
        setResult({ r: out.result, zip: out.zip, folder: out.folder })
        downloadBlob(out.zip, `${out.folder}.zip`)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // folder picker cancelled
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('Export failed: ' + msg)
    } finally { setBusy(false) }
  }

  return (
    <>
      {pack && !pack.ready && (
        <div className="callout warn"><div className="col"><b>Data pack needed to export</b><span className="small">The exporter builds on the map template from your own SR1 Map Studio package. It stays in this browser and is never uploaded. <Link to="/setup">Set up data pack</Link></span></div></div>
      )}
      <div className="group">
        <span className="section-title">Map</span>
        <div className="form-grid">
          <Field label="File name (max 11)" hint={nameError || `Files: ${name || '…'}.bbchunk_xbox2 …`}>
            <input value={s.base_name} maxLength={11} onChange={(e) => set('base_name', e.target.value, true)} />
          </Field>
          <Field label="Display name" hint="Shown in the game's map list.">
            <input value={s.display_name} maxLength={40} onChange={(e) => set('display_name', e.target.value, true)} />
          </Field>
        </div>
        <span className="small muted">Game modes</span>
        <div className="row wrap">
          {GAME_MODES.map((m) => (
            <Check key={m} checked={s.modes.includes(m)} onChange={(v) => set('modes', GAME_MODES.filter((x) => (x === m ? v : s.modes.includes(x))))}>{m}</Check>
          ))}
        </div>
        {modeCheck.warnings.map((w) => <span key={w} className="small warn">{w}</span>)}
        {entries.length > 0 && (
          <table className="mats" style={{ marginTop: 4 }}>
            <thead><tr><th>Mode</th><th>Spawn file</th><th title="Unique across every installed map pack; stays the same while the file name and mode stay the same">Level ID</th><th title="Weapon and vehicle slots a Custom match can swap: the distinct types you placed (6 weapons when none)">Custom slots</th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.mode}><td>{e.mode}</td><td className="mono">{e.ctsFile}.cts</td><td className="mono">{e.id}</td><td>{e.weapons} weapon{e.weapons === 1 ? '' : 's'}, {e.vehicles} vehicle{e.vehicles === 1 ? '' : 's'}</td></tr>
            ))}</tbody>
          </table>
        )}
        <Check checked={s.always_clear_weather} onChange={(v) => set('always_clear_weather', v)}
          title="On: every match is noon with clear skies (what all custom maps do today). Off: the game rolls the time of day and weather each match, like retail maps; not yet tested on custom maps.">
          Always clear weather (noon, clear skies)
        </Check>
        {!s.always_clear_weather && <span className="small muted">Each match gets a random time (noon, midnight, dusk or dawn) and weather. Untested on custom maps: check your sky and lighting at night.</span>}
      </div>

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
          </div>
        </div>
      </div>

      <div className="group">
        <span className="section-title">Sky &amp; minimap</span>
        <Field label="Native sky" hint={hasGroup(pack, 'sky') ? 'Experimental: stages the original sky resource pair with your map.' : 'Native sky presets are not in your data pack.'}>
          <select value={s.native_sky} disabled={!hasGroup(pack, 'sky')} onChange={(e) => set('native_sky', e.target.value as ProjectSettings['native_sky'])}>
            <option value="">None</option>
            <option value="sr_alwayshwyf01">sr_alwayshwyf01 (Downtown / Factory)</option>
            <option value="sr_custom000001">sr_custom000001 (Seafood)</option>
          </select>
        </Field>
        <FileSetting label="Fake sky image" hint="Optional. Blank = no fake skybox." k="sky_texture" accept="image/*,.tga,.dds" />
        {s.sky_texture && <Field label="Skybox size (0 = auto)"><NumberInput value={s.sky_scale} step={0.5} min={0} max={100} onChange={(v) => set('sky_scale', v)} /></Field>}
        <FileSetting label="Minimap image" hint="Optional top-down image, 1024×1024 with alpha recommended." k="minimap_texture" accept="image/*,.tga,.dds" />
        <FileSetting label="Native BBCity donor (advanced)" hint="Optional .bbcity_xbox2 from your game for native city metadata. Stays on this device." k="bbcity_donor" accept=".bbcity_xbox2" />
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
            <div className="row"><button className="sm" onClick={() => downloadBlob(result.zip, `${result.folder}.zip`)}>Download again</button></div>
          </div>
        </div>
      )}
      <p className="faint small">Export runs entirely in your browser using the original SR1 Map Studio exporter (Python, in WebAssembly). Nothing is uploaded.</p>
    </>
  )
}

function FileSetting({ label, hint, k, accept }: { label: string; hint: string; k: 'sky_texture' | 'minimap_texture' | 'bbcity_donor'; accept: string }) {
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

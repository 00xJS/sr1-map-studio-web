import { useEffect, useState } from 'react'
import { useEditor, currentProject } from '../store'
import * as act from '../actions'
import { getViewer } from '../Viewport'
import { FileButton, toastError, useBusy, infoDialog } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import { textureUrl } from '../../lib/assets'
import { dataPackStatus, hasGroup, dataPackBlob, type DataPackStatus } from '../../lib/datapack'
import { isGlass, type Asset } from '../../lib/project'
import { py } from '../../lib/py'
import { Link } from 'react-router-dom'
import { openMapFiles } from '../../lib/mapFolder/store'

function Thumb({ asset }: { asset: Asset }) {
  const project = useEditor((s) => s.project)
  const [url, setUrl] = useState<string | null>(null)
  const tex = Object.values(asset.textures || {})[0]
  useEffect(() => { if (tex) textureUrl(project, tex).then(setUrl) }, [tex])
  return url ? <img src={url} alt="" /> : <span className="tex-thumb" />
}

export function AssetsPanel() {
  const project = useEditor((s) => s.project)!
  const [selected, setSelected] = useState(-1)
  const [style, setStyle] = useState(Object.keys(catalogs.glass_styles)[0])
  const [pack, setPack] = useState<DataPackStatus | null>(null)
  const [run, busy] = useBusy()
  useEffect(() => { dataPackStatus().then(setPack) }, [])
  const center = () => getViewer()?.center() ?? [0, 0, 0]
  const lib = project.asset_library

  return (
    <>
      <div className="section">
      <span className="section-title">Your library</span>
      <span className="small muted">Import models to your library, then drag them onto the map. Double-click one to place it where the camera is looking.</span>
      <div className="row wrap">
        <FileButton className="primary" multiple accept=".obj,.mtl,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.bmp,.dds,.tif,.tiff" onFiles={(f) => run(() => act.importModelFiles(f, 'library'))}>+ Import to library</FileButton>
        <button disabled={selected < 0 || !project.scene_items.length} onClick={() => run(() => act.placeAsset(selected, center() as any))}>Place selected</button>
        <button className="quiet" disabled={selected < 0} onClick={() => run(async () => { if (await act.removeAsset(selected)) setSelected(-1) })}>Remove</button>
      </div>
      <div className="list">
        {lib.map((a, i) => (
          <div
            key={a.uid} draggable className={'list-item' + (i === selected ? ' selected' : '')}
            onClick={() => setSelected(i)}
            onDoubleClick={() => { if (project.scene_items.length) act.placeAsset(i, center() as any).catch(toastError) }}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-sr1-asset', String(i)); e.dataTransfer.effectAllowed = 'copy' }}
          >
            <Thumb asset={a} />
            <div className="grow">
              <div>{a.name}</div>
              <div className="meta">{isGlass(a) ? 'Native breakable glass' : `${(a.triangles ?? 0).toLocaleString()} tris · ${Object.keys(a.textures || {}).length} textures`}</div>
            </div>
          </div>
        ))}
        {!lib.length && <div className="list-item faint">Your library is empty.</div>}
      </div>
      </div>

      <div className="section">
        <span className="section-title">Breakable glass</span>
        {hasGroup(pack, 'glass') ? (
          <>
            <div className="row">
              <select className="grow" value={style} onChange={(e) => setStyle(e.target.value)}>
                {Object.keys(catalogs.glass_styles).map((s) => <option key={s}>{s}</option>)}
              </select>
              <button disabled={busy} onClick={() => run(() => act.addGlass(style, center() as any))}>+ Add glass</button>
            </div>
            <p className="faint small">Native pane: {catalogs.glass_size.map((v) => v.toFixed(2)).join(' × ')} game units. Move, rotate or duplicate it; export embeds its collision and shatter effect.</p>
          </>
        ) : <p className="faint small">Needs the glass prefab from your data pack. <Link to="/setup">Set up data pack</Link></p>}
      </div>

      <div className="section">
        <span className="section-title">From your files</span>
        <div className="row wrap">
          {hasGroup(pack, 'demo') && <button className="sm" disabled={busy} onClick={() => run(importDemoCrate)}>Add demo crate to library</button>}
          <FileButton className="sm" multiple accept=".bbchunk_xbox2,.peg_xbox2" onFiles={(f) => run(() => extractGameMap(f))}>Import a map from the game…</FileButton>
        </div>
        <div className="row wrap">
          <FileButton className="sm" directory onFiles={(f) => run(() => openMapFiles(f))} title="A map folder from SaintsReborn/dist/maps: opens it as a map of its own, to edit and export again, or to upgrade">Open a map folder…</FileButton>
          <FileButton className="sm" accept=".zip" onFiles={(f) => run(() => openMapFiles(f))} title="A zip of a map folder">Open a map zip…</FileButton>
        </div>
        <p className="faint small"><b>Open a map folder</b> opens a finished map (yours from a while ago, or one from <code>SaintsReborn/dist/maps</code>) as a new map with every object, spawn and trigger, to change and export again; it can also add the game's sky to it without rebuilding. You can drop a map folder or zip on the 3D view too.</p>
        <p className="faint small"><b>Where to load from:</b> "Import a map from the game" converts a <code>.bbchunk_xbox2</code> (select its <code>.peg_xbox2</code> too for textures) from your own game install into an editable model. Installed maps live in <code>SaintsReborn/dist/maps/&lt;map name&gt;/levels/</code>, for example <code>SaintsReborn/dist/maps/Dust/levels/dust.bbchunk_xbox2</code> and <code>dust.peg_xbox2</code>. The original game's own maps are packed inside <code>SaintsReborn/dist/game/packfiles</code> and can't be picked directly.</p>
        <p className="faint small"><b>Where your maps go:</b> exports install into <code>SaintsReborn/dist/maps/&lt;your map name&gt;/</code>. ▶ Play puts them there for you, or unzip a downloaded export into <code>SaintsReborn/dist/maps</code>.</p>
        <p className="faint small">Files from your game stay on this device and can't be shared to the Showcase.</p>
      </div>
    </>
  )
}

async function importDemoCrate() {
  const names = ['crate_low_test.obj', 'crate_low_test.mtl', 'crate_wood.png']
  const files: File[] = []
  for (const n of names) {
    const blob = await dataPackBlob('demo_crate/' + n)
    if (blob) files.push(new File([blob], n))
  }
  await act.importModelFiles(files, 'library')
}

async function extractGameMap(files: File[]) {
  const chunk = files.find((f) => /\.bbchunk_xbox2$/i.test(f.name))
  if (!chunk) throw new Error('Choose a .bbchunk_xbox2 file (and optionally its .peg_xbox2).')
  const peg = files.find((f) => /\.peg_xbox2$/i.test(f.name))
  const stem = chunk.name.replace(/\.bbchunk_xbox2$/i, '')
  const job = '/work/extract/' + Date.now().toString(36)
  await py.writeFiles([
    { path: `${job}/in/${chunk.name}`, data: await chunk.arrayBuffer() },
    ...(peg ? [{ path: `${job}/in/${peg.name}`, data: await peg.arrayBuffer() }] : []),
  ])
  const out = await py.call<{ report: Record<string, unknown>; files: string[] }>('extract_bbchunk', `${job}/in/${chunk.name}`, peg ? `${job}/in/${peg.name}` : null, `${job}/out/${stem}.obj`)
  // The extractor also writes helper OBJs (e.g. <map>_static_markers.obj); import only the map itself.
  const read = await py.readFiles(out.files.filter((p) => p.endsWith(`/${stem}.obj`) || /\.(mtl|png)$/i.test(p)))
  const extracted = read.map((f) => new File([f.data], f.path.split('/').pop()!))
  const imported = await act.importModelFiles(extracted, 'library')
  // Everything extracted from a retail map is game data: keep it local-only.
  if (currentProject()) useEditor.getState().update('Mark game files', (d) => {
    for (const m of imported) for (const path of Object.keys(m.files)) if (d.files[path]) d.files[path].origin = 'game'
  })
  const r = out.report as Record<string, number>
  await infoDialog('Map imported', `Extracted ${Number(r.faces).toLocaleString()} triangles across ${r.meshes} groups; ${r.decoded_textures ?? 0} textures decoded. It's in your asset library (game data: this device only). Native shader effects are not reconstructed.`)
}

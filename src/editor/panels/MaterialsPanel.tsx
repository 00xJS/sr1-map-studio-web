import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '../store'
import * as act from '../actions'
import { FileButton, useBusy } from '../../ui'
import { catalogs } from '../../lib/catalogs'
import { loadModel, textureUrl } from '../../lib/assets'
import { baseName, isCustomNative, isGlass } from '../../lib/project'

interface Row { index: number; item: string; mat: string; tex: string; alpha: boolean; surface: number; native: boolean; custom: boolean }

function TexThumb({ path }: { path: string }) {
  const project = useEditor((s) => s.project)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { setUrl(null); if (path) textureUrl(project, path).then(setUrl) }, [path])
  return url ? <img className="tex-thumb" src={url} alt="" /> : <span className="tex-thumb" />
}

export function MaterialsPanel() {
  const project = useEditor((s) => s.project)!
  const solo = useEditor((s) => s.soloMaterial)
  const update = useEditor((s) => s.update)
  const [mats, setMats] = useState<Record<string, string[]>>({})
  const [query, setQuery] = useState('')
  const [run] = useBusy()

  useEffect(() => {
    let live = true
    Promise.all(project.scene_items.map((it) => loadModel(project, it.path).then((m) => [it.path, m.mats.map((x) => x || 'default')] as const).catch(() => [it.path, []] as const)))
      .then((r) => { if (live) setMats(Object.fromEntries(r)) })
    return () => { live = false }
  }, [project.scene_items.map((i) => i.path).join('|')])

  const rows: Row[] = useMemo(() => project.scene_items.flatMap((it, index) => (mats[it.path] || []).map((mat) => {
    const custom = isCustomNative(it)
    return {
      index, item: it.name, mat, custom, native: isGlass(it),
      tex: custom ? it.glass_custom_texture || '' : it.textures?.[mat] || '',
      alpha: custom ? (it.native_opacity ?? 100) < 100 : isGlass(it) ? it.glass_style === 'tinted' : !!it.alpha?.[mat],
      surface: isGlass(it) ? (it.native_breakable_kind === 'wood' ? 21 : 8) : it.surface_ids?.[mat] ?? 0,
    }
  })), [project.scene_items, mats])

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const visible = rows.filter((r) => terms.every((t) => `${r.item} ${r.mat} ${baseName(r.tex)} ${catalogs.surface_types[r.surface]}`.toLowerCase().includes(t)))
  const missing = rows.filter((r) => !r.tex).length

  return (
    <>
      <div className="row">
        <input className="grow" placeholder="Search materials or texture names…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="faint small">{query ? `${visible.length} / ${rows.length}` : rows.length} materials</span>
      </div>
      {missing > 0 && <div className="callout warn"><span>{missing} material{missing === 1 ? '' : 's'} need a texture before you can export.</span></div>}
      <div style={{ overflow: 'auto' }}>
        <table className="mats">
          <thead><tr><th>Material</th><th>Texture</th><th title="Use the texture's alpha channel">Alpha</th><th>Surface</th></tr></thead>
          <tbody>
            {visible.map((r) => {
              const key = `${r.index}:${r.mat}`
              return (
                <tr key={key} className={solo === key ? 'selected' : ''}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.mat}</div>
                    <div className="faint small">{String(r.index).padStart(2, '0')} {r.item}</div>
                    <button className={'sm quiet' + (solo === key ? ' on' : '')} onClick={() => useEditor.getState().set({ soloMaterial: solo === key ? null : key })}>{solo === key ? 'Show all' : 'Solo'}</button>
                  </td>
                  <td>
                    <div className="row">
                      <TexThumb path={r.tex} />
                      <div className="col" style={{ gap: 2 }}>
                        <span className={r.tex ? 'small' : 'small bad'} style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.tex ? baseName(r.tex) : 'missing'}</span>
                        <div className="row">
                          <FileButton className="sm" accept="image/*,.tga,.dds,.tif,.tiff" onFiles={([f]) => run(() => act.assignTexture(r.index, r.mat, f))}>Assign</FileButton>
                          {r.tex && !r.native && <button className="sm quiet" onClick={() => update('Clear texture', (d) => { d.scene_items[r.index].textures[r.mat] = '' })}>Clear</button>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <input type="checkbox" checked={r.alpha} disabled={r.native} title={r.native ? 'Use the Scene tab opacity control for custom breakables. Fixed panes use their glass style.' : ''}
                      onChange={(e) => update('Use alpha', (d) => { d.scene_items[r.index].alpha[r.mat] = e.target.checked })} />
                  </td>
                  <td>
                    <select value={r.surface} disabled={r.native} title={r.native ? 'Native objects use their built-in Wood or Glass surface.' : ''}
                      onChange={(e) => update('Surface type', (d) => { (d.scene_items[r.index].surface_ids ||= {})[r.mat] = +e.target.value })}>
                      {catalogs.surface_types.map((n, i) => <option key={n} value={i}>{n}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="faint small">Surface type sets footsteps, bullet impacts and decals (exported as the texture's physical suffix, e.g. _{catalogs.surface_suffixes[0]}). Alpha is off unless you opt in: in Halo-style diffuse maps alpha is often a detail mask.</p>
    </>
  )
}

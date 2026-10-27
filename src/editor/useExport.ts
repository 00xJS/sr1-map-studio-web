// Export and install, shared by the Play dialog and the advanced Export tab.
import { useEffect, useRef, useState } from 'react'
import { useEditor, saveNow } from './store'
import { confirmDialog } from '../ui'
import { runExport, downloadBlob, type ExportResult } from '../lib/exporter'
import { py } from '../lib/py'
import { ExportTimer, exportStages, loadStageTimes, saveStageTimes, type ProgressView } from '../lib/exportProgress'
import { installedProjectId, mapFolderExists, mapsFolder, rememberedMapsFolder, writeMap } from '../lib/install'
import { withAutoMinimap } from '../lib/minimap'
import { withLoadingScreen } from '../lib/mapFeatures'
import { getViewer } from './Viewport'

export interface ExportDone { r: ExportResult; zip: () => Promise<Blob>; folder: string; installedTo?: string }

export function useExport() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportDone | null>(null)
  const [error, setError] = useState('')
  const [mapsDir, setMapsDir] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressView | null>(null)
  const timer = useRef<ExportTimer | null>(null)
  useEffect(() => { rememberedMapsFolder().then(setMapsDir) }, [])
  // Python's stages arrive as events; a tick keeps the elapsed time and estimate moving.
  useEffect(() => {
    if (!busy) return
    const show = () => timer.current && setProgress(timer.current.view())
    const off = py.onProgress((p) => { timer.current?.enter(p.stage, p.done, p.total); show() })
    const tick = setInterval(show, 500)
    return () => { off(); clearInterval(tick) }
  }, [busy])

  /** Must be called straight from a click: browsers only show folder pickers then. */
  const run = async (target: 'install' | 'download', chooseFolder = false, before?: () => void) => {
    setError(''); setResult(null)
    const log = useEditor.getState().log
    try {
      // Ask for the folder first, before anything is awaited.
      const maps = target === 'install' ? await mapsFolder(chooseFolder) : null
      if (maps) setMapsDir(maps.name)
      const t = timer.current = new ExportTimer(exportStages({ boot: py.status !== 'ready', install: !!maps }), loadStageTimes())
      setProgress(t.view())
      setBusy(true)
      before?.()
      await py.init()
      t.enter('prepare')
      await saveNow()
      const viewer = getViewer()
      const withMinimap = await withAutoMinimap(useEditor.getState().project!, viewer ? { rect: (pad) => viewer.minimapRect(pad), capture: (o) => viewer.captureTopDown(o) } : undefined, log)
      const project = await withLoadingScreen(withMinimap, viewer ? (w, h) => viewer.capture(w, h) : undefined, log)
      const out = await runExport(project, log, (stage) => t.enter(stage))
      log(`Export complete: ${out.result.files.length} map files.`)
      if (maps) {
        t.enter('install')
        // This project's own last install is replaced without asking (the companion mod then reloads it in the match).
        const own = await installedProjectId(maps, out.folder) === project.id
        if (!own && await mapFolderExists(maps, out.folder) && !(await t.outside(confirmDialog('Replace installed map?', `maps/${out.folder} already exists. Its files will be replaced with this export.`, { confirm: 'Replace' })))) {
          setResult({ r: out.result, zip: out.zip, folder: out.folder })
          return
        }
        const n = await writeMap(maps, out.entries)
        saveStageTimes(t.finish())
        log(`Installed ${n} files to maps/${out.folder}.`)
        setResult({ r: out.result, zip: out.zip, folder: out.folder, installedTo: `${maps.name}/${out.folder}` })
      } else {
        downloadBlob(await out.zip(), `${out.folder}.zip`)
        saveStageTimes(t.finish())
        setResult({ r: out.result, zip: out.zip, folder: out.folder })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // folder picker cancelled
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log('Export failed: ' + msg)
    } finally { setBusy(false); timer.current = null; setProgress(null) }
  }

  return { busy, result, error, mapsDir, progress, run }
}

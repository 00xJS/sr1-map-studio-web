// Export and install, shared by the Play dialog and the advanced Export tab.
import { useEffect, useState } from 'react'
import { useEditor, saveNow } from './store'
import { confirmDialog } from '../ui'
import { runExport, downloadBlob, type ExportResult } from '../lib/exporter'
import { mapFolderExists, mapsFolder, rememberedMapsFolder, writeMap } from '../lib/install'

export interface ExportDone { r: ExportResult; zip: Blob; folder: string; installedTo?: string }

export function useExport() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportDone | null>(null)
  const [error, setError] = useState('')
  const [mapsDir, setMapsDir] = useState<string | null>(null)
  useEffect(() => { rememberedMapsFolder().then(setMapsDir) }, [])

  /** Must be called straight from a click: browsers only show folder pickers then. */
  const run = async (target: 'install' | 'download', chooseFolder = false, before?: () => void) => {
    setError(''); setResult(null)
    const log = useEditor.getState().log
    try {
      // Ask for the folder first, before anything is awaited.
      const maps = target === 'install' ? await mapsFolder(chooseFolder) : null
      if (maps) setMapsDir(maps.name)
      setBusy(true)
      before?.()
      await saveNow()
      const out = await runExport(useEditor.getState().project!, log)
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

  return { busy, result, error, mapsDir, run }
}

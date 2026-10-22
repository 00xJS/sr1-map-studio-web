// The "data pack" is the game-derived reference material the exporter needs
// (Beaver Creek template, glass/prop prefabs, sky presets, CTS templates).
// The site never hosts it: each user loads it from their own copy of the
// SR1 Map Studio desktop package. Files are checked against the package's
// published SHA-256 list and stored only in this browser.
import { unzip } from 'fflate'
import manifest from './datapack-manifest.json'
import { db, sha256 } from './db'

export type DataPackGroup = 'required' | 'glass' | 'props' | 'cts' | 'sky' | 'demo'
type Entry = { sha256: string; size: number; group: DataPackGroup }
export const DATAPACK = manifest as Record<string, Entry>

export const GROUP_LABELS: Record<DataPackGroup, string> = {
  required: 'Map template (required to export)',
  glass: 'Breakable glass prefab',
  props: 'Movable and explosive props',
  cts: 'Spawn table templates',
  sky: 'Native sky presets (large, optional)',
  demo: 'Demo crate',
}

export interface DataPackStatus {
  groups: Record<DataPackGroup, { have: number; total: number }>
  ready: boolean
}

export async function dataPackStatus(): Promise<DataPackStatus> {
  const have = new Set(await db.listDataPack())
  const groups = {} as DataPackStatus['groups']
  for (const [path, e] of Object.entries(DATAPACK)) {
    groups[e.group] ??= { have: 0, total: 0 }
    groups[e.group].total++
    if (have.has(path)) groups[e.group].have++
  }
  return { groups, ready: groups.required.have === groups.required.total }
}

export const hasGroup = (s: DataPackStatus | null, g: DataPackGroup) => !!s && s.groups[g].have === s.groups[g].total

/** Maps "anything/SR1_Map_Studio_v1.13/native_glass/pane.obj" to "native_glass/pane.obj". */
function packPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, '/').split('/')
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join('/')
    if (candidate in DATAPACK) return candidate
  }
  return null
}

export interface ImportReport { added: string[]; skipped: string[]; mismatched: string[] }

async function storeCandidates(cands: { path: string; data: Uint8Array | Blob }[], onProgress?: (t: string) => void): Promise<ImportReport> {
  const report: ImportReport = { added: [], skipped: [], mismatched: [] }
  const ok: { path: string; blob: Blob; sha256: string }[] = []
  for (const c of cands) {
    const blob = c.data instanceof Blob ? c.data : new Blob([c.data])
    const hash = await sha256(blob)
    const expected = DATAPACK[c.path]
    if (hash !== expected.sha256) { report.mismatched.push(c.path); continue }
    ok.push({ path: c.path, blob, sha256: hash })
    report.added.push(c.path)
    onProgress?.(`Checked ${report.added.length} files…`)
  }
  await db.putDataPackFiles(ok)
  return report
}

export function importDataPackZip(file: File, onProgress?: (t: string) => void): Promise<ImportReport> {
  return new Promise((resolve, reject) => {
    onProgress?.('Reading zip…')
    file.arrayBuffer().then((buf) => {
      const kept: Record<string, string> = {}
      unzip(new Uint8Array(buf), {
        filter: (f) => {
          const p = packPath(f.name)
          if (p) kept[f.name] = p
          return !!p
        },
      }, (err, files) => {
        if (err) { reject(new Error(`Couldn't read ${file.name} as a zip (${err.message}). Choose the SR1 Map Studio package zip, or its extracted folder.`)); return }
        const cands = Object.entries(files).map(([name, data]) => ({ path: kept[name], data }))
        if (!cands.length) {
          reject(new Error('No SR1 Map Studio data files were found in that zip. Choose the SR1_Map_Studio_v1.13 package zip.'))
          return
        }
        storeCandidates(cands, onProgress).then(resolve, reject)
      })
    }, reject)
  })
}

export async function importDataPackFiles(files: File[], onProgress?: (t: string) => void): Promise<ImportReport> {
  const cands: { path: string; data: Blob }[] = []
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const p = packPath(rel)
    if (p) cands.push({ path: p, data: f })
  }
  if (!cands.length) throw new Error('No SR1 Map Studio data files were found in that folder.')
  return storeCandidates(cands, onProgress)
}

export async function dataPackBlob(path: string): Promise<Blob | undefined> {
  return (await db.getDataPackFile(path))?.blob
}

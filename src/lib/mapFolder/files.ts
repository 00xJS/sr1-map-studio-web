// Finding a map in what the player hands over: a folder picked with the folder picker, a folder dropped on the
// page, a zip of one, or a few loose files. A map is a folder with levels/<map>.bbchunk_xbox2 in it (and its
// bundle_info.xtbl beside levels/), the layout of SaintsReborn/dist/maps/<name>/; a pick of the whole maps
// folder or a zip of several holds more than one. Everything stays in memory in this tab.
import { unzip } from 'fflate'

/** One map folder: its name, and its files by path inside it ("levels/dust.cts"), as given. */
export interface MapSource {
  name: string
  files: Map<string, Blob>
}

const CHUNK = /\.bbchunk_xbox2$/i

/** Path → file, case-blind. */
export function fileAt(src: MapSource, path: string): Blob | undefined {
  const want = path.toLowerCase()
  for (const [p, f] of src.files) if (p.toLowerCase() === want) return f
  return undefined
}

/** The map chunks in levels/ (names without the extension). */
export const chunkStems = (src: MapSource) => [...src.files.keys()].filter((p) => /^levels\/[^/]+\.bbchunk_xbox2$/i.test(p)).map((p) => p.slice(7).replace(CHUNK, ''))

/**
 * The maps among some files with their paths ("Dust/levels/dust.cts"; the folder picker's webkitRelativePath).
 * `fallback` names a map whose files sit at the top (a zip of one map's contents, or loose files).
 */
export function findMaps(entries: [string, Blob][], fallback = 'Map'): MapSource[] {
  const norm = entries.map(([p, f]) => [p.replace(/\\/g, '/').replace(/^\/+/, ''), f] as [string, Blob])
  // A map's root: the folder above levels/, or the chunk's own folder when there is no levels/ (loose files).
  const loose = new Map<string, boolean>()
  for (const [p] of norm) {
    if (!CHUNK.test(p)) continue
    const parts = p.split('/')
    const i = parts.map((x) => x.toLowerCase()).lastIndexOf('levels')
    if (i >= 0) loose.set(parts.slice(0, i).join('/'), false)
    else { const r = parts.slice(0, -1).join('/'); if (!loose.has(r)) loose.set(r, true) }
  }
  // Deepest first, so a map inside another folder of the pick doesn't take the outer one's files.
  const ordered = [...loose.keys()].sort((a, b) => b.length - a.length)
  const out = new Map<string, MapSource>()
  for (const [p, f] of norm) {
    const root = ordered.find((r) => !r || p.toLowerCase().startsWith(r.toLowerCase() + '/'))
    if (root === undefined) continue
    let rel = root ? p.slice(root.length + 1) : p
    // Loose files: the map's files go in levels/, as installed; bundle_info and the notes stay at the top.
    if (loose.get(root) && !rel.includes('/') && !/^bundle_info\.xtbl$|^MAP_STUDIO_EXPORT\.txt$|\.json$/i.test(rel)) rel = 'levels/' + rel
    let m = out.get(root)
    if (!m) out.set(root, (m = { name: root.split('/').pop() || fallback, files: new Map() }))
    m.files.set(rel, f)
  }
  return [...out.values()].filter((m) => chunkStems(m).length).sort((a, b) => a.name.localeCompare(b.name))
}

const stemOf = (files: File[]) => files.find((f) => CHUNK.test(f.name))?.name.replace(CHUNK, '') ?? 'Map'

/** Files from the folder picker (each knows its path in the pick). */
export const fromPicked = (files: File[]) => findMaps(files.map((f) => [(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, f]), stemOf(files))

/** The maps in a zip. */
export async function fromZip(zip: Blob, name = 'Map'): Promise<MapSource[]> {
  const data = new Uint8Array(await zip.arrayBuffer())
  const files = await new Promise<Record<string, Uint8Array>>((ok, no) => unzip(data, (e, r) => (e ? no(e) : ok(r))))
  const entries = Object.entries(files).filter(([p]) => !p.endsWith('/')).map(([p, d]) => [p, new Blob([d])] as [string, Blob])
  return findMaps(entries, name.replace(/\.zip$/i, ''))
}

/** Picked files: a zip is opened, a folder pick read by its paths. */
export async function fromFiles(files: File[]): Promise<MapSource[]> {
  const zips = files.filter((f) => /\.zip$/i.test(f.name))
  const out = fromPicked(files.filter((f) => !zips.includes(f)))
  for (const z of zips) out.push(...(await fromZip(z, z.name)))
  return out
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string }
type FileEntry = Entry & { file(ok: (f: File) => void, no: (e: unknown) => void): void }
type DirEntry = Entry & { createReader(): { readEntries(ok: (e: Entry[]) => void, no: (e: unknown) => void): void } }

async function walk(e: Entry, out: [string, Blob][]) {
  if (e.isFile) {
    const f = await new Promise<File>((ok, no) => (e as FileEntry).file(ok, no))
    out.push([e.fullPath.replace(/^\//, ''), f])
  } else if (e.isDirectory) {
    const reader = (e as DirEntry).createReader()
    // readEntries hands over a batch at a time, until an empty one.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, no) => reader.readEntries(ok, no))
      if (!batch.length) break
      for (const x of batch) await walk(x, out)
    }
  }
}

const entryOf = (it: DataTransferItem) => (it as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null

/** True when a drop holds a folder, a zip or a map chunk (rather than models to import). */
export function dropHasMap(dt: DataTransfer): boolean {
  if (Array.from(dt.items).some((it) => entryOf(it)?.isDirectory)) return true
  return Array.from(dt.files).some((f) => /\.zip$/i.test(f.name) || CHUNK.test(f.name))
}

/** The maps in a drop: dropped folders are read through, zips opened; loose files make one map. */
export async function fromDrop(dt: DataTransfer): Promise<MapSource[]> {
  const entries: [string, Blob][] = []
  const zips: File[] = []
  // Entries must be taken before the first await: the drop's items go away after the event.
  const items = Array.from(dt.items).map(entryOf)
  const files = Array.from(dt.files)
  for (const [i, e] of items.entries()) {
    if (e?.isDirectory) await walk(e, entries)
    else if (files[i] && /\.zip$/i.test(files[i].name)) zips.push(files[i])
    else if (files[i]) entries.push([files[i].name, files[i]])
  }
  const out = findMaps(entries, stemOf(files))
  for (const z of zips) out.push(...(await fromZip(z, z.name)))
  return out
}

/** Text of a file in the map (Latin-1, as the game's text files are; a UTF-8 byte-order mark is skipped). */
export async function textOf(src: MapSource, path: string): Promise<string | null> {
  const f = fileAt(src, path)
  if (!f) return null
  const b = new Uint8Array(await f.arrayBuffer())
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  return new TextDecoder('latin1').decode(b.subarray(start))
}

/** Every file of the map as bytes, under "<folder>/", ready to zip or to write into the maps folder. */
export async function folderEntries(src: MapSource, folder = src.name, replace: Record<string, Uint8Array> = {}): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  const swap = new Map(Object.entries(replace).map(([k, v]) => [k.toLowerCase(), v]))
  for (const [p, f] of src.files) {
    out[`${folder}/${p}`] = swap.get(p.toLowerCase()) ?? new Uint8Array(await f.arrayBuffer())
    swap.delete(p.toLowerCase())
  }
  // New files (a notes file the folder didn't have).
  for (const [p, v] of Object.entries(replace)) if (swap.has(p.toLowerCase())) out[`${folder}/${p}`] = v
  return out
}

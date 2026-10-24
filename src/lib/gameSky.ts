// The game's own sky at export: the sun, moon, stars and clouds of the retail map mp_bac_01, read from the player's
// mp_city_stream.vpp_xbox2 (see py/native_sky.py). The chunk and only the sky's pictures go to the exporter's
// in-memory file system, once per tab; nothing read here is uploaded, published or stored. Without the game files
// (or when the map has no room left) the map keeps its fake sky image.
import { py } from './py'
import { gamePack, MP_PACK } from './gameFiles'
import { openVpp, type Vpp } from './sr1char/vpp'
import { readChunk, type Chunk } from './gameObjects/chunk'
import { pegHeadSize } from './gameObjects/textures'
import { gameSkyWanted, type Project } from './project'

export { gameSkyWanted }

export const SKY_SOURCE = 'mp_bac_01'
/** The five sky objects of a retail outdoor map, by record name. */
export const SKY_OBJECTS = ['Sun', 'Moon', 'Stars', 'Atmosphere', 'Cloud Layer']
const GAME_DIR = '/work/game', DONOR = GAME_DIR + '/native_sky'

/** The picture names the five sky objects' materials use, in first-use order. Throws when the chunk has no sky. */
export function skyTextureNames(ch: Chunk): string[] {
  const recs = ch.records.filter((r) => SKY_OBJECTS.includes(r.name))
  if (new Set(recs.map((r) => r.name)).size !== SKY_OBJECTS.length) throw new Error('this map chunk has no sky')
  const out: string[] = []
  for (const r of recs) {
    const mesh = ch.meshes[ch.instances[r.instance]?.mesh]
    if (!mesh) throw new Error('sky object ' + r.name + ' has no mesh')
    for (const s of mesh.subs) for (const b of s.batches) {
      for (const t of ch.materials[b.material]?.textures ?? []) if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
    }
  }
  return out
}

/** One texture-file entry as the exporter copies it: its 72-byte record, and where its pixels are. */
export interface PegPick { name: string; entry: Uint8Array; offset: number; size: number }

/**
 * The entries of a texture file (read from its head alone) that hold pixels for the names given, matched without
 * case. Names it lacks are left out: the game keeps those loaded all the time. Says how many bytes are needed when
 * the head is too short.
 */
export function pegPicks(head: Uint8Array, names: string[]): PegPick[] | { need: number } {
  if (head.length < 0x18 || String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'VKEG') throw new Error('not a texture file')
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const count = dv.getUint16(16)
  if (head.length < pegHeadSize(count)) return { need: pegHeadSize(count) }
  const want = new Set(names.map((n) => n.toLowerCase()))
  const out: PegPick[] = []
  for (let i = 0; i < count; i++) {
    const o = 0x18 + 0x48 * i
    let e = o + 23, name = ''
    while (head[e] && e < o + 0x34) name += String.fromCharCode(head[e++])
    const size = dv.getUint32(o + 0x34)
    if (!size || !want.has(name.toLowerCase()) || out.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ name, entry: head.slice(o, o + 0x48), offset: dv.getUint32(o), size })
  }
  return out
}

export interface SkyFiles { chunk: Uint8Array; pictures: { name: string; entry: Uint8Array; data: Uint8Array }[]; shared: string[] }

/** mp_bac_01's chunk and the sky's pictures from the player's game, or null when the game files can't be read without asking. */
export async function gameSkyFiles(ask: boolean): Promise<SkyFiles | null> {
  const file = await gamePack(MP_PACK, ask)
  return file ? skyFilesFrom(await openVpp(file, MP_PACK)) : null
}

/** The same from an opened mp_city_stream packfile; null when it lacks mp_bac_01. */
export async function skyFilesFrom(vpp: Vpp): Promise<SkyFiles | null> {
  const chunkName = SKY_SOURCE + '.bbchunk_xbox2', pegName = SKY_SOURCE + '.peg_xbox2'
  if (!vpp.has(chunkName) || !vpp.has(pegName)) return null
  const chunk = await vpp.read(chunkName)
  const names = skyTextureNames(readChunk(chunk))
  let picks = pegPicks(await vpp.readHead(pegName, 65536), names)
  if ('need' in picks) picks = pegPicks(await vpp.readHead(pegName, picks.need), names)
  if ('need' in picks) throw new Error(pegName + ' is cut short')
  // The packfile is compressed: inflate only as far as the last sky picture (about 8 of mp_bac_01's 62 MB).
  const end = Math.max(0, ...picks.map((p) => p.offset + p.size))
  const head = await vpp.readHead(pegName, end)
  if (head.length < end) throw new Error(pegName + ' is cut short')
  const pictures = picks.map((p) => ({ name: p.name, entry: p.entry, data: head.slice(p.offset, p.offset + p.size) }))
  const shared = names.filter((n) => !picks.some((p) => p.name.toLowerCase() === n.toLowerCase()))
  return { chunk, pictures, shared }
}

/** Whether the export can read the game's sky now, without asking for the folder. */
export async function gameSkyAvailable(): Promise<boolean> {
  try { return !!(await gamePack(MP_PACK, false)) } catch { return false }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/**
 * What the exporter reads (py/native_sky.py), by path under the game-files folder: mp_bac_01's chunk (deleted once
 * the sky is copied out of it), and in native_sky/ the pictures and textures.json naming them.
 */
export function skyDonorFiles(files: SkyFiles): { path: string; data: Uint8Array }[] {
  const textures = files.pictures.map((p, i) => ({ name: p.name, entry: hex(p.entry), file: `texture_${String(i).padStart(2, '0')}.bin`, bytes: p.data.length }))
  return [
    { path: `${SKY_SOURCE}.bbchunk_xbox2`, data: files.chunk },
    ...files.pictures.map((p, i) => ({ path: 'native_sky/' + textures[i].file, data: p.data })),
    { path: 'native_sky/textures.json', data: new TextEncoder().encode(JSON.stringify({ source: SKY_SOURCE, textures, shared: files.shared })) },
  ]
}

/** The export spec's native_sky_source, or nothing when the game's sky is off or can't be read. Never asks for the folder. */
export async function gameSkySpec(project: Project, onLog: (t: string) => void): Promise<{ native_sky_source?: Record<string, string> }> {
  if (!gameSkyWanted(project.settings)) return {}
  const [ready] = await py.exists([DONOR + '/sky.json'])
  if (ready) return { native_sky_source: { dir: DONOR } }
  let files: SkyFiles | null = null
  try {
    onLog("Reading the game's sky from your game files…")
    files = await gameSkyFiles(false)
  } catch (e) {
    onLog("Sky: your game files could not be read: " + (e as Error).message)
  }
  if (!files) {
    onLog("Sky: the game's own sky needs your Saints Reborn folder (Export panel, Sky section); "
      + (project.settings.sky_texture ? 'using the fake sky image.' : 'this map has no fake sky image either, so the sky is black.'))
    return {}
  }
  await py.writeFiles(skyDonorFiles(files).map((f) => ({ path: GAME_DIR + '/' + f.path, data: copy(f.data) })))
  return { native_sky_source: { dir: DONOR, chunk: `${GAME_DIR}/${SKY_SOURCE}.bbchunk_xbox2` } }
}

const copy = (b: Uint8Array) => b.buffer.byteLength === b.byteLength ? b.buffer as ArrayBuffer : b.slice().buffer as ArrayBuffer

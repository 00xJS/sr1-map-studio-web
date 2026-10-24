// Quick upgrades for a finished map: changes py/map_upgrade.py makes to the map's own chunk and texture file,
// without opening it in the editor and exporting again. The rest of the folder is handed back as it was, as a
// zip or straight into the game's maps folder. Each upgrade here matches one in map_upgrade.UPGRADES by key: the
// page lists them with these words, Python says whether the map has it already or has room for it. To add one,
// add it there and here (with `prepare` when it needs files from the player's game).
import { py } from '../py'
import { gameSkyFiles, skyDonorFiles } from '../gameSky'
import { folderEntries, type MapSource } from './files'
import type { MapInfo } from './info'

export interface MapUpgrade {
  key: string
  title: string
  hint: string
  /** Files it needs from the player's game, handed to Python before it runs; `ask` lets the browser ask for the folder. */
  prepare?: (ask: boolean) => Promise<Record<string, unknown>>
}

const GAME_DIR = '/work/game', SKY_DONOR = GAME_DIR + '/native_sky'
const copy = (b: Uint8Array) => (b.buffer.byteLength === b.byteLength ? b.buffer as ArrayBuffer : b.slice().buffer as ArrayBuffer)

/** mp_bac_01's sky, as the exporter takes it (gameSky.ts), once per tab. */
async function skySource(ask: boolean): Promise<Record<string, unknown>> {
  const [ready] = await py.exists([SKY_DONOR + '/sky.json'])
  if (ready) return { game_sky: { dir: SKY_DONOR } }
  const files = await gameSkyFiles(ask)
  if (!files) throw new Error("The game's sky is read from your game files: choose your Saints Reborn folder when the browser asks.")
  await py.writeFiles(skyDonorFiles(files).map((f) => ({ path: `${GAME_DIR}/${f.path}`, data: copy(f.data) })))
  return { game_sky: { dir: SKY_DONOR, chunk: `${GAME_DIR}/mp_bac_01.bbchunk_xbox2` } }
}

export const MAP_UPGRADES: MapUpgrade[] = [
  {
    key: 'game_sky', title: "Add the game's sky",
    hint: "The sun, moon, stars and moving clouds of the game's own outdoor maps (from mp_bac_01 in your game files), in place of the flat sky picture.",
    prepare: skySource,
  },
]

export type UpgradeState = { state: 'available' | 'done' | 'unavailable'; why: string }

export interface MapCheck {
  upgrades: Record<string, UpgradeState>
  /** Sky objects the map has. */
  sky: number
  lights: number
}

const jobDir = () => '/work/mapupgrade/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Which upgrades the map can take. */
export async function checkUpgrades(info: MapInfo): Promise<MapCheck> {
  const job = jobDir()
  const chunk = `${job}/${info.stem}.bbchunk_xbox2`
  await py.writeFiles([{ path: chunk, data: await info.chunk.arrayBuffer() }])
  const r = await py.call<{ upgrades: Record<string, UpgradeState>; sky: number; lights: unknown[] }>('map_tool', 'inspect', JSON.stringify({ chunk }))
  await py.remove([chunk])
  return { upgrades: r.upgrades, sky: r.sky, lights: r.lights.length }
}

export interface UpgradeResult {
  /** The whole folder, upgraded, under "<folder>/". */
  entries: Record<string, Uint8Array>
  folder: string
  applied: string[]
  skipped: Record<string, string>
  log: string[]
}

/**
 * Applies the upgrades to a copy of the map's chunk and texture file. Call from a click: an upgrade that needs
 * the game files may ask for the folder first, before anything else is awaited.
 */
export async function runUpgrades(info: MapInfo, keys: string[], ask = true): Promise<UpgradeResult> {
  if (!info.peg) throw new Error(`${info.src.name} has no texture file (levels/${info.stem}.peg_xbox2).`)
  const chosen = MAP_UPGRADES.filter((u) => keys.includes(u.key))
  const spec: Record<string, unknown> = {}
  for (const u of chosen) if (u.prepare) Object.assign(spec, await u.prepare(ask))
  const job = jobDir()
  const chunk = `${job}/${info.stem}.bbchunk_xbox2`, peg = `${job}/${info.stem}.peg_xbox2`
  await py.writeFiles([{ path: chunk, data: await info.chunk.arrayBuffer() }, { path: peg, data: await info.peg.arrayBuffer() }])
  const r = await py.call<{ applied: string[]; skipped: Record<string, string>; log: string[] }>('map_tool', 'upgrade', JSON.stringify({ ...spec, chunk, peg, upgrades: chosen.map((u) => u.key) }))
  const [c, p] = await py.readFiles([chunk, peg])
  await py.remove([chunk, peg])
  const replace: Record<string, Uint8Array> = {}
  if (r.applied.length) {
    replace[`levels/${info.stem}.bbchunk_xbox2`] = new Uint8Array(c.data)
    replace[`levels/${info.stem}.peg_xbox2`] = new Uint8Array(p.data)
    replace['MAP_STUDIO_UPGRADES.txt'] = await upgradeNotes(info.src, r.applied)
  }
  const folder = info.src.name
  return { entries: await folderEntries(info.src, folder, replace), folder, applied: r.applied, skipped: r.skipped, log: r.log }
}

/** A note beside the map of what was changed and when, added to the one already there. */
async function upgradeNotes(src: MapSource, applied: string[]): Promise<Uint8Array> {
  const CRLF = '\r\n'
  const lines = applied.map((k) => `${new Date().toISOString()}  ${MAP_UPGRADES.find((u) => u.key === k)?.title ?? k} (SR1 Map Studio web, quick upgrade)`)
  const before = [...src.files].find(([p]) => p.toLowerCase() === 'map_studio_upgrades.txt')?.[1]
  const head = before ? (await before.text()).replace(/\s*$/, CRLF) : 'Quick upgrades made to this map by SR1 Map Studio (web), without rebuilding it:' + CRLF
  return new TextEncoder().encode(head + lines.join(CRLF) + CRLF)
}

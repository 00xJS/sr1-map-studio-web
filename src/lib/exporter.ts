// Full map export: runs sr1_export.export_map in the worker and packages the
// result as a folder you can drop into SaintsReborn/dist/maps.
import { zip as zipAsync, strFromU8, strToU8, type AsyncZippable } from 'fflate'
import { py } from './py'
import { dataPackStatus, hasGroup } from './datapack'
import { dryInteriors, type Marker, type Project, type ProjectSettings, type Vec3 } from './project'
import { checkModes, levelEntries } from './levels'
import { BOR } from './retailModes'
import { crateDebrisSpec } from './crateDebris'
import { gameSkySpec } from './gameSky'
import { exportedItems } from './layers'
import { PICKUP_RESPAWN_MS, pickupRespawnMs } from './player'
import { exportFactLines } from './playtest'

/**
 * entries: the zip's files by path ("<folder>/levels/..."), for installing without unzipping.
 * zip: made only when asked for (installing doesn't need it), off the main thread.
 */
export interface ExportOutput { result: ExportResult; zip: () => Promise<Blob>; folder: string; entries: Record<string, Uint8Array> }

export interface ExportResult {
  map_name: string
  files: string[]
  summary: Record<string, number>
  /** The frame of the map's geometry: game metres = mirror_x((editor - origin) * world_scale). */
  origin?: Vec3
  /** The lowest point of the map's geometry, in game metres. */
  floor_y?: number
}

const strip = <T extends { uid?: string }>(x: T) => { const { uid: _u, ...rest } = x; return rest }

/** onStage: 'prepare' and 'pack', the editor-side stages around Python's own (see exportProgress.ts). */
export async function runExport(project: Project, onLog: (t: string) => void, onStage?: (stage: 'prepare' | 'pack') => void): Promise<ExportOutput> {
  const status = await dataPackStatus()
  if (!status.ready) throw new Error('Set up your data pack first (Data pack page): the exporter needs the Beaver Creek map template from your SR1 Map Studio package.')
  const modeCheck = checkModes(project.settings, project.markers)
  if (modeCheck.errors.length) throw new Error(modeCheck.errors.join('\n'))
  onLog('Preparing files…')
  const missing = await py.syncProject(project)
  if (missing.length) throw new Error('These files are not on this device yet:\n' + missing.map((m) => m.split('/').pop()).join('\n'))
  const s = project.settings
  let sky: { native_sky_chunk?: string; native_sky_peg?: string } = {}
  if (s.surface_preload && !hasGroup(status, 'surface')) throw new Error('Early surface registration needs the surface template from your data pack: add your SR1 Map Studio package again on the Data pack page.')
  if (s.native_sky || s.surface_preload) {
    // Early surface registration builds its environment pair from a stock sky (sr_custom000001 unless one is chosen).
    if (!status.groups.sky.have) throw new Error('Native sky presets are not in your data pack.')
    await py.mountSkies()
  }
  if (s.native_sky) {
    sky = { native_sky_chunk: `/studio/native_sky_presets/${s.native_sky}.bbchunk_xbox2`, native_sky_peg: `/studio/native_sky_presets/${s.native_sky}.peg_xbox2` }
  }
  const job = Date.now().toString(36)
  const crate = await crateDebrisSpec(project, onLog)
  const gameSky = await gameSkySpec(project, onLog)
  const spec = {
    job,
    // Hidden layers too, unless the project leaves them out (layers.ts).
    scene_items: exportedItems(project).map(strip),
    markers: project.markers.map(strip),
    lights: project.lights.map(strip),
    base_name: s.base_name, world_scale: s.world_scale, mirror_x: s.mirror_x, flip_obj_v: s.flip_obj_v,
    double_sided: s.double_sided, sky_texture: s.sky_texture, minimap_texture: s.minimap_texture, minimap_rect: s.minimap_rect, sky_scale: s.sky_scale,
    bbcity_donor: s.bbcity_donor, cts_template: s.cts_template, marker_game_coords: s.marker_game_coords, ...sky,
    // Early surface registration: the map's textures copied into a map-specific sf_ environment pair (py/surface_registration.py).
    surface_preload: !!s.surface_preload,
    ptp: s.modes.includes('Protect Tha Pimp'),
    // Blinged Out Ride: <map>_bor.cts and <map>_mode.xtbl (py/bor_mode.py).
    bor: s.modes.includes(BOR),
    ...crate,
    // The game's own sky from the player's game files (py/native_sky.py); the fake sky image stays as the fallback.
    ...gameSky,
    // Extras written after the main export (py/map_features.py).
    ambience: s.ambience || '', loading_image: s.loading_mode === 'none' ? '' : s.loading_image || '',
    // Rain blockers note when there's no rain to block (py/regions.py).
    always_clear_weather: s.always_clear_weather,
    // Rain blockers over the floor under roofs and ceilings (py/interiors.py): only when it can rain.
    dry_interiors: dryInteriors(s),
    // Sliver triangles out of the collision (py/collision_fix.py), unless switched off.
    remove_invisible_walls: s.remove_invisible_walls !== false,
  }
  onLog('Running SR1 map exporter…')
  const result = await py.call<ExportResult>('export_project', JSON.stringify(spec))
  onStage?.('pack')
  const files = await py.readFiles(result.files)
  const folder = (s.display_name || result.map_name).replace(/[<>:"/\\|?*]+/g, '').trim() || result.map_name
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    const name = f.path.split('/').pop()!
    // Map files go in levels/; the exporter's audit reports sit beside it.
    entries[/\.(json|txt)$/i.test(name) ? `${folder}/${name}` : `${folder}/levels/${name}`] = new Uint8Array(f.data)
  }
  // Every weapon pickup comes back after its own time (the marker's, or the game's default for the weapon).
  for (const [k, v] of Object.entries(entries)) if (/\.cts$/i.test(k)) entries[k] = strToU8(withPickupRespawns(strFromU8(v), project.markers))
  Object.assign(entries, packageMetadata(folder, result.map_name, s.display_name || result.map_name, s, project.markers, project.description))
  entries[`${folder}/MAP_STUDIO_EXPORT.txt`] = strToU8(exportNotes(project, result))
  return { result, zip: lazyZip(entries), folder, entries }
}

/** The exporter's own weapon pickup items in a CTS: name, type and start nav, one block each, in marker order. */
const STUDIO_ITEM = /^\$Item:[ \t]*"([^"\r\n]*__studio_\$item\d+)"(\r?\n)\$Item type:[^\r\n]*\r?\n\$Start nav:[ \t]*"\1"\r?\n(?!\$Respawn Delay:)/gm

/**
 * A CTS with `$Respawn Delay:` on each weapon pickup the exporter wrote, in the order of the map's Weapon pickup
 * markers: the marker's own time, or the game's default for the weapon (15 s, sniper 20 s, RPG 30 s).
 */
export function withPickupRespawns(cts: string, markers: Pick<Marker, 'type' | 'weapon' | 'label' | 'respawn_ms'>[]): string {
  const weapons = markers.filter((m) => m.type === 'Weapon pickup')
  let k = 0
  return cts.replace(STUDIO_ITEM, (block: string, _name: string, nl: string) => {
    const m = weapons[k++]
    return m ? `${block}$Respawn Delay:\t${pickupRespawnMs(m.weapon || m.label, m.respawn_ms)}${nl}` : block
  })
}

/**
 * The map files are mostly compressed textures (a big map's PEG is 80+ MB):
 * light deflate packs them nearly as small as level 6 in about half the time.
 */
export function lazyZip(entries: Record<string, Uint8Array>): () => Promise<Blob> {
  let made: Promise<Blob> | null = null
  return () => made ??= new Promise<Blob>((resolve, reject) => {
    const files: AsyncZippable = {}
    for (const [k, v] of Object.entries(entries)) files[k] = [v, { level: /_xbox2$/.test(k) ? 1 : 6 }]
    zipAsync(files, (err, data) => err ? reject(err) : resolve(new Blob([data], { type: 'application/zip' })))
  }).catch((e) => { made = null; throw e })
}

const CRLF = '\r\n'

/** Game languages that read their own strings file; the map's text is the same in each. */
export const STRING_LANGUAGES = ['US', 'DE', 'ES', 'FR', 'IT', 'JP'] as const

/** One line of a strings file: no line breaks, and "=" would end the key. */
const stringValue = (s: string, max = 400) => s.replace(/[\r\n=]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The help text shown for the map in the game's menus: the project description, or a plain default. */
export const helpText = (display: string, description: string | undefined) =>
  stringValue(description || '') || stringValue(`${display}: a custom map made with SR1 Map Studio.`)

/**
 * Same layout and formatting as the community maps installed in SaintsReborn/dist/maps:
 * bundle_info, the level list, the help page for the map and its strings in every game language.
 */
export function packageMetadata(folder: string, map: string, display: string, settings: Pick<ProjectSettings, 'modes' | 'always_clear_weather'>, markers: Marker[], description = ''): Record<string, Uint8Array> {
  const bundle = ['<root>', '<Table>', '\t<BundleInfo>', '\t\t<BundleInfoFlags>', '\t\t\t<Flag>BUNDLE_TYPE_LEVEL</Flag>', '\t\t\t</BundleInfoFlags>', '\t\t</BundleInfo>', '\t</Table>', '</root>', ''].join(CRLF)
  const flags = settings.always_clear_weather
    ? ['\t\t<Flags>', '\t\t\t<Flag>AlwaysClearWeather</Flag>', '\t\t\t</Flags>']
    : []
  const levels = levelEntries(map, settings.modes.length ? settings.modes : ['Gangsta Brawl'], markers).map((e) => [
    '\t<MultiplayerLevel>',
    `\t\t<Name>${e.name}</Name>`,
    `\t\t<Mode>${e.mode}</Mode>`,
    `\t\t<Map>${map}</Map>`,
    `\t\t<CTSFile>${e.ctsFile}</CTSFile>`,
    '\t\t<_Editor>', '\t\t\t<Category>Entries</Category>', '\t\t\t</_Editor>',
    `\t\t<DisplayName>MULTI_LEVEL_${map}</DisplayName>`,
    `\t\t<ID>${e.id}</ID>`,
    ...flags,
    '\t\t<MinimapZoom>1.5</MinimapZoom>',
    '\t\t<LevelSelectionWeight>500</LevelSelectionWeight>',
    '\t\t<Optimal_Players_Min>2</Optimal_Players_Min>',
    '\t\t<Optimal_Players_Max>12</Optimal_Players_Max>',
    `\t\t<num_customizable_weapons>${e.weapons}</num_customizable_weapons>`,
    `\t\t<num_customizable_vehicles>${e.vehicles}</num_customizable_vehicles>`,
    '\t\t</MultiplayerLevel>',
  ].join(CRLF)).join(CRLF)
  const xtbl = ['<root>', '<Table>', levels, '\t</Table>', '</root>', ''].join(CRLF)
  // The map's page in the game's help screens: its name and help text, by string key.
  // No <ID> in here, so it cannot clash with another pack's level IDs.
  const helpKey = `HELP_TEXT_${map.toUpperCase()}_LEVEL`
  const help = ['<root>', '<Table>', '\t<HelpPage>', `\t\t<Name>level_${map}</Name>`, '\t\t<OnPage>MPLevel</OnPage>',
    `\t\t<DisplayName>MULTI_LEVEL_${map}</DisplayName>`, `\t\t<DisplayText>${helpKey}</DisplayText>`,
    '\t\t<_Editor>', '\t\t\t<Category>Entries</Category>', '\t\t\t</_Editor>', '\t\t<DisplayMask>Multi</DisplayMask>',
    '\t\t</HelpPage>', '\t</Table>', '</root>', ''].join(CRLF)
  const lines = [`MULTI_LEVEL_${map}=${stringValue(display, 60)}`, `${helpKey}=${helpText(display, description)}`]
  // BINTEXT, a blank line, the entries, then the entry count right-aligned.
  const strings = ['BINTEXT', '', ...lines, String(lines.length).padStart(14), ''].join(CRLF)
  const out: Record<string, Uint8Array> = {
    [`${folder}/bundle_info.xtbl`]: strToU8(bundle),
    [`${folder}/levels/multiplayer_levels_extra.xtbl`]: strToU8(xtbl),
    [`${folder}/levels/help_screens.xtbl`]: strToU8(help),
  }
  for (const lang of STRING_LANGUAGES) out[`${folder}/levels/${lang}_strings.txt`] = utf16le(strings)
  return out
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2)
  out[0] = 0xff; out[1] = 0xfe
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c & 0xff; out[3 + i * 2] = c >> 8 }
  return out
}

function exportNotes(p: Project, r: ExportResult) {
  const s = r.summary
  return [
    `Exported by SR1 Map Studio (web) on ${new Date().toISOString()}`,
    `Project: ${p.name}`,
    // For the companion mod's playtest log and for installing over this project's own map without asking.
    ...(r.origin ? exportFactLines({ projectId: p.id, origin: r.origin, worldScale: p.settings.world_scale || 0.5, mirrorX: p.settings.mirror_x, floorY: r.floor_y ?? 0 }) : [`Project id: ${p.id}`]),
    '',
    `Render: ${s.render_triangles?.toLocaleString()} triangles in ${s.render_meshes} mesh(es), ${s.material_batches} material batches`,
    `Collision: ${s.collision_triangles?.toLocaleString()}/${s.source_triangles?.toLocaleString()} source triangles`,
    `Native objects: ${s.native_objects} (including ${s.native_props} movable/explosive props)`,
    `Native point lights: ${s.lights} (first gameplay test pending)`,
    ...(s.water_volumes ? [`Swimmable water: ${s.water_volumes} volume(s) (new, not yet tried in game)`] : []),
    ...(s.regions - (s.dry_boxes ?? 0) > 0 ? [`Rain blockers and indoor rooms: ${s.regions - (s.dry_boxes ?? 0)} (new, not yet tried in game)`] : []),
    ...(s.dry_boxes ? [`Dry interiors: ${s.dry_boxes} box(es) over the floor under roofs and ceilings, where the rain stops (new, not yet tried in game)`] : []),
    `Sky: ${s.game_sky ? "the game's own sky from mp_bac_01 in your game files (new, not yet tried in game)"
      : p.settings.native_sky ? `native sky preset ${p.settings.native_sky}` : p.settings.surface_preload ? 'the stock sr_custom000001 environment of early surface registration'
      : p.settings.sky_texture ? 'fake sky image' : 'none (black in game)'}`,
    ...(s.surface_textures ? [`Early surface registration: ${s.surface_textures} texture(s) registered through the two sf_… files in levels/; install them with the map (experimental, not yet tried in game)`] : []),
    '',
    `Weapon pickups come back after ${PICKUP_RESPAWN_MS.normal / 1000} s (sniper rifle ${PICKUP_RESPAWN_MS.sniper / 1000} s, RPG ${PICKUP_RESPAWN_MS.launcher / 1000} s) unless a marker sets its own time.`,
    '',
    'Install: copy this whole folder into SaintsReborn/dist/maps, then start the game.',
    'Back up any map with the same name first. Test new native props, glass and lights in a private match.',
  ].join(CRLF)
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

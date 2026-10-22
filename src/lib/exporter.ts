// Full map export: runs sr1_export.export_map in the worker and packages the
// result as a folder you can drop into SaintsReborn/dist/maps.
import { zipSync, strToU8 } from 'fflate'
import { py } from './py'
import { dataPackStatus } from './datapack'
import type { Marker, Project, ProjectSettings } from './project'
import { checkModes, levelEntries } from './levels'

/** entries: the zip's files by path ("<folder>/levels/..."), for installing without unzipping. */
export interface ExportOutput { result: ExportResult; zip: Blob; folder: string; entries: Record<string, Uint8Array> }

export interface ExportResult {
  map_name: string
  files: string[]
  summary: Record<string, number>
}

const strip = <T extends { uid?: string }>(x: T) => { const { uid: _u, ...rest } = x; return rest }

export async function runExport(project: Project, onLog: (t: string) => void): Promise<ExportOutput> {
  const status = await dataPackStatus()
  if (!status.ready) throw new Error('Set up your data pack first (Data pack page): the exporter needs the Beaver Creek map template from your SR1 Map Studio package.')
  const modeCheck = checkModes(project.settings, project.markers)
  if (modeCheck.errors.length) throw new Error(modeCheck.errors.join('\n'))
  onLog('Preparing files…')
  const missing = await py.syncProject(project)
  if (missing.length) throw new Error('These files are not on this device yet:\n' + missing.map((m) => m.split('/').pop()).join('\n'))
  const s = project.settings
  let sky: { native_sky_chunk?: string; native_sky_peg?: string } = {}
  if (s.native_sky) {
    if (!status.groups.sky.have) throw new Error('Native sky presets are not in your data pack.')
    await py.mountSkies()
    sky = { native_sky_chunk: `/studio/native_sky_presets/${s.native_sky}.bbchunk_xbox2`, native_sky_peg: `/studio/native_sky_presets/${s.native_sky}.peg_xbox2` }
  }
  const job = Date.now().toString(36)
  const spec = {
    job,
    scene_items: project.scene_items.map(strip),
    markers: project.markers.map(strip),
    lights: project.lights.map(strip),
    base_name: s.base_name, world_scale: s.world_scale, mirror_x: s.mirror_x, flip_obj_v: s.flip_obj_v,
    double_sided: s.double_sided, sky_texture: s.sky_texture, minimap_texture: s.minimap_texture, sky_scale: s.sky_scale,
    bbcity_donor: s.bbcity_donor, cts_template: s.cts_template, marker_game_coords: s.marker_game_coords, ...sky,
    ptp: s.modes.includes('Protect Tha Pimp'),
  }
  onLog('Running SR1 map exporter…')
  const result = await py.call<ExportResult>('export_project', JSON.stringify(spec))
  const files = await py.readFiles(result.files)
  const folder = (s.display_name || result.map_name).replace(/[<>:"/\\|?*]+/g, '').trim() || result.map_name
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    const name = f.path.split('/').pop()!
    // Map files go in levels/; the exporter's audit reports sit beside it.
    entries[/\.(json|txt)$/i.test(name) ? `${folder}/${name}` : `${folder}/levels/${name}`] = new Uint8Array(f.data)
  }
  Object.assign(entries, packageMetadata(folder, result.map_name, s.display_name || result.map_name, s, project.markers))
  entries[`${folder}/MAP_STUDIO_EXPORT.txt`] = strToU8(exportNotes(project, result))
  const zip = new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' })
  return { result, zip, folder, entries }
}

const CRLF = '\r\n'

/** Same layout and formatting as the community maps installed in SaintsReborn/dist/maps. */
export function packageMetadata(folder: string, map: string, display: string, settings: Pick<ProjectSettings, 'modes' | 'always_clear_weather'>, markers: Marker[]): Record<string, Uint8Array> {
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
  const strings = `BINTEXT${CRLF}${CRLF}MULTI_LEVEL_${map}=${display.replace(/[\r\n=]/g, ' ')}${CRLF}${' '.repeat(13)}1${CRLF}`
  return {
    [`${folder}/bundle_info.xtbl`]: strToU8(bundle),
    [`${folder}/levels/multiplayer_levels_extra.xtbl`]: strToU8(xtbl),
    [`${folder}/levels/US_strings.txt`]: utf16le(strings),
  }
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
    '',
    `Render: ${s.render_triangles?.toLocaleString()} triangles in ${s.render_meshes} mesh(es), ${s.material_batches} material batches`,
    `Collision: ${s.collision_triangles?.toLocaleString()}/${s.source_triangles?.toLocaleString()} source triangles`,
    `Native objects: ${s.native_objects} (including ${s.native_props} movable/explosive props)`,
    `Native point lights: ${s.lights} (first gameplay test pending)`,
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

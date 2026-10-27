// The walk-through's weather row: the time of day and weather to walk the map in (the Lighting presets), rain
// falling while the camera is outside the map's rain blockers (editor/rain.ts), and their outlines. The boxes are
// the export's own: Rain blocker / Indoor room markers, and with "Keep interiors dry" on, what py/interiors.py
// finds over the floor under roofs (lib/rainPreview.ts).
import { useEffect, useState } from 'react'
import type { Viewer } from './Viewer'
import { useEditor } from './store'
import { choosePreset, useLook } from './look'
import { solidTriangles } from './stairActions'
import { PRESETS } from '../lib/gameLight'
import { dryRainBoxes, markerRainBoxes, rainOf, type RainBox } from '../lib/rainPreview'
import { exportedItems } from '../lib/layers'
import { dryInteriors, type Vec3 } from '../lib/project'

/** The export's dry-interior boxes for the map as it is (py/web_api.py dry_boxes). */
async function dryBoxes(): Promise<RainBox[]> {
  const p = useEditor.getState().project
  if (!p || !dryInteriors(p.settings)) return []
  const keep = new Set(exportedItems(p))
  const { tris } = await solidTriangles(p, (it) => keep.has(it))
  const { py } = await import('../lib/py')
  return dryRainBoxes(p, tris, async (metres) => {
    const path = '/work/rainpreview/tris.bin'
    await py.writeFiles([{ path, data: metres.buffer.slice(metres.byteOffset, metres.byteOffset + metres.byteLength) as ArrayBuffer }])
    return py.call<[Vec3, Vec3][]>('dry_boxes', path)
  })
}

export function WeatherHud({ viewer }: { viewer: Viewer | null }) {
  const project = useEditor((s) => s.project)!
  const preset = useLook((s) => s.preset)
  const needsFiles = useLook((s) => s.needsFiles)
  const [show, setShow] = useState(false)
  const [dry, setDry] = useState<RainBox[] | null>(null)
  const [here, setHere] = useState(false)
  const clear = project.settings.always_clear_weather
  // Always-clear maps get no rain in game, whatever the light.
  const amount = clear ? 0 : rainOf(preset)
  const markers = markerRainBoxes(project)

  // The export's own boxes, once per walk (they come from the whole map's geometry).
  useEffect(() => {
    let live = true
    dryBoxes().then((b) => { if (live) setDry(b) }, () => { if (live) setDry([]) })
    return () => { live = false }
     
  }, [])
  useEffect(() => {
    viewer?.rain.set({ amount, boxes: [...markers, ...(dry ?? [])], showBoxes: show, ws: project.settings.world_scale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, amount, show, dry, JSON.stringify(project.markers), project.settings.world_scale])
  useEffect(() => {
    const t = setInterval(() => setHere(!!viewer?.rain.dry), 250)
    return () => clearInterval(t)
  }, [viewer])

  const boxes = markers.length + (dry?.length ?? 0)
  return (
    <div className="row wrap small" style={{ gap: 8 }}>
      <label className="row" style={{ gap: 4 }} title="Walk the map at this time of day and weather (times other than noon read your game files)">
        Weather
        <select value={preset} onChange={(e) => { void choosePreset(e.target.value) }} aria-label="Time of day and weather">
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <label className="row" title="Outline the boxes where the game stops the rain: your Rain blocker and Indoor room markers, and the ones Keep interiors dry adds on export">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Rain blockers{dry ? ` (${boxes})` : ''}
      </label>
      <span className="muted">
        {clear && rainOf(preset) ? 'This map is always clear in game: no rain falls there (Weather: Changes each match).'
          : !amount ? 'Pick a rainy weather to check where the rain stops.'
          : dry === null ? 'Working out the export’s rain blockers…'
          : here ? '☂ Inside a rain blocker: no rain here in game.' : 'Raining here in game.'}
        {needsFiles && ' (Lit at noon: open your game files for other times and weathers.)'}
      </span>
    </div>
  )
}

// The walk-through's weather preview (lib/rainPreview.ts): how hard each preset rains, the rain blockers' boxes
// as the export writes them, and the camera test the game makes against them.
import { describe, expect, it } from 'vitest'
import { newProject, type Marker, type Vec3 } from '../src/lib/project'
import { dryRainBoxes, insideRain, markerRainBoxes, rainOf } from '../src/lib/rainPreview'

const marker = (type: string, position: Vec3, yaw = 0, size?: Vec3) => ({ uid: type, type, position, yaw, ...(size ? { size } : {}) }) as unknown as Marker

describe('the weather preview', () => {
  it('rains only under the rainy presets, harder in a storm', () => {
    expect(['noon', 'night', 'rain', 'storm', 'nightrain'].map(rainOf)).toEqual([0, 0, 0.85, 1, 0.85])
  })

  it('stops the rain inside rain blockers and indoor rooms, turned as their markers are', () => {
    const p = newProject('Rain')
    p.settings.world_scale = 0.5
    p.markers = [marker('Rain blocker', [0, 0, 0], 90, [4, 3, 10]), marker('Indoor room', [100, 0, 0]), marker('Shared spawn', [50, 0, 50])]
    const boxes = markerRainBoxes(p)
    expect(boxes.map((b) => b.size)).toEqual([[8, 6, 20], [32, 16, 32]])
    // Turned 90°: 20 units deep along X now, 8 across along Z.
    expect(insideRain(boxes, [9, 1, 0])).toBe(true)
    expect(insideRain(boxes, [0, 1, 9])).toBe(false)
    expect(insideRain(boxes, [9, 7, 0])).toBe(false)
    expect(insideRain(boxes, [110, 15, -10])).toBe(true)
  })

  it('adds the export\'s dry-interior boxes (metres back to editor units), only when the export makes them', async () => {
    const p = newProject('Rain')
    p.settings.world_scale = 0.5
    p.settings.always_clear_weather = false
    let sent: Float32Array | null = null
    const run = async (m: Float32Array) => { sent = m; return [[[-2, 0, -3], [2, 4, 3]]] as [Vec3, Vec3][] }
    const boxes = await dryRainBoxes(p, Float32Array.from([2, 4, 6, 0, 0, 0, 0, 0, 0]), run)
    expect([...sent!.slice(0, 3)]).toEqual([1, 2, 3])
    expect(boxes).toEqual([{ at: [0, 0, 0], size: [8, 8, 12], yaw: 0, dry: true }])
    p.settings.always_clear_weather = true
    expect(await dryRainBoxes(p, Float32Array.from([1, 1, 1]), run)).toEqual([])
  })
})

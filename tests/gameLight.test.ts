// The game lighting model: the table reader on a small made-up table, and the real tables from a local game install
// when there is one (SR1_PACKFILES, or the default install folder); nothing from the game is copied into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { NOON, lightAt, maxDetail, parseXml, readLightTables } from '../src/lib/gameLight'
import { openVpp } from '../src/lib/sr1char/vpp'
import { GAME_TESTS } from './testMode'

const seg = (name: string, time: number, sun: number[], opts = '') => `<Time_Segment><Name>${name}</Name><Time>${time}</Time><Light_Type><Flag>${opts.includes('moon') ? 'Moon' : 'Sun'}</Flag></Light_Type>
  <Parameters><Colors><Level_Ambient_Light_Color><R>96</R><G>105</G><B>120</B></Level_Ambient_Light_Color><Tod_Light_Color><R>${sun[0]}</R><G>${sun[1]}</G><B>${sun[2]}</B></Tod_Light_Color>
  <Fill_Light_Color><R>57</R><G>68</G><B>72</B></Fill_Light_Color></Colors><Fog><Fog_Strength>0.5</Fog_Strength><Fog_Start_Distance>0</Fog_Start_Distance><Fog_End_Distance>186</Fog_End_Distance></Fog>
  <Sun><Sun_Rotation_Angle>30</Sun_Rotation_Angle><Light_Rotation_Angle>60</Light_Rotation_Angle></Sun></Parameters></Time_Segment>`
const TOD = `<root><Table>${seg('noon', 1200, [200, 100, 0])}${seg('night', 0, [0, 0, 100], 'moon')}</Table></root>`
const WEATHER = `<root><Table><Weather_Time_Segment><Name>day</Name><Start_Time>600</Start_Time><Weather_Stages>
  <Stage><Stage_Name>Heavy Rain</Stage_Name><Light_Colors><Main_Light><R>51</R><G>51</G><B>51</B></Main_Light></Light_Colors><Fog><Strength>0.8</Strength><End_Dist>25</End_Dist></Fog></Stage>
  </Weather_Stages></Weather_Time_Segment></Table></root>`

describe('game lighting', () => {
  it('reads nested XML', () => {
    const x = parseXml('<a><b>1</b><c><d>two</d></c><e/></a>')
    expect(x.kids[0].kids.map((k) => k.tag)).toEqual(['b', 'c', 'e'])
    expect(x.kids[0].kids[1].kids[0].text).toBe('two')
  })

  it('blends between times of day, the short way round, and lets a weather stage replace what it defines', () => {
    const t = readLightTables(TOD, WEATHER)
    expect(t.segments.map((s) => s.name)).toEqual(['night', 'noon'])
    const noon = lightAt(t, 1200)
    expect(noon.sun.map((v) => Math.round(v * 255))).toEqual([200, 100, 0])
    expect(noon.ambient.map((v) => Math.round(v * 255))).toEqual([96, 105, 120])
    // 18:00 is half way from noon (orange sun) to midnight (blue moon).
    expect(lightAt(t, 1800).sun.map((v) => Math.round(v * 255))).toEqual([100, 50, 50])
    expect(Math.hypot(...noon.sunDir)).toBeCloseTo(1, 5)
    expect(noon.sunDir[1]).toBeGreaterThan(0.5)
    const rain = lightAt(t, 1200, 'Heavy Rain')
    expect(rain.sun.map((v) => Math.round(v * 255))).toEqual([51, 51, 51])
    expect(rain.fog).toMatchObject({ strength: 0.8, end: 25, start: 0 })
    expect(rain.ambient).toEqual(noon.ambient)
  })

  it('has the noon look built in and the SRMaxDetail variant', () => {
    expect(NOON.fog.strength).toBe(0.5)
    expect(Math.hypot(...NOON.sunDir)).toBeCloseTo(1, 1)
    const m = maxDetail(NOON)
    expect(m.ambient[0]).toBeCloseTo(NOON.ambient[0] * 0.8, 5)
    expect(m.sun[0]).toBeCloseTo(Math.min(1, NOON.sun[0] * 1.12), 5)
  })
})

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
describe.runIf(GAME_TESTS && existsSync(GAME + '/misc.vpp_xbox2'))('game lighting from the local install', () => {
  it('matches the built-in noon look, and has night and rain', async () => {
    const vpp = await openVpp(await openAsBlob(GAME + '/misc.vpp_xbox2'), 'misc.vpp_xbox2')
    const dec = new TextDecoder('latin1')
    const t = readLightTables(dec.decode(await vpp.read('time_of_day.xtbl')), dec.decode(await vpp.read('weather_time_of_day.xtbl')))
    expect(t.segments.length).toBeGreaterThan(10)
    const noon = lightAt(t, 1200)
    const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
    expect(close(noon.sun, NOON.sun, 2 / 255)).toBe(true)
    expect(close(noon.ambient, NOON.ambient, 2 / 255)).toBe(true)
    expect(close(noon.fill, NOON.fill, 2 / 255)).toBe(true)
    expect(close(noon.sunDir, NOON.sunDir, 0.02)).toBe(true)
    expect(close(noon.fillDir, NOON.fillDir, 0.02)).toBe(true)
    expect(noon.fog.strength).toBeCloseTo(0.5, 2)
    const night = lightAt(t, 0)
    expect(night.sun[0]).toBeLessThan(noon.sun[0])
    expect(night.fog.strength).toBeGreaterThan(noon.fog.strength)
    expect(lightAt(t, 1200, 'Heavy Rain').fog.end).toBeLessThan(60)
  })
})

// Vehicle models (src/lib/vehicles): the .car_xbox2 container read on a small car built here, the variant choice, and
// (with a local Saints Reborn install) every one of the game's 84 vehicles. No game file is copied into the repo.
import { describe, expect, it } from 'vitest'
import { existsSync, openAsBlob } from 'node:fs'
import { GAME_TESTS } from './testMode'
import { openVpp } from '../src/lib/sr1char/vpp'
import { volitionHash } from '../src/lib/sr1char/hash'
import { findTexture, indexPeg } from '../src/lib/gameObjects/textures'
import type { Cmesh } from '../src/lib/sr1char/cmesh'
import { chooseDraws, defaultVariant, parseCar, parseCarVariants, readCarHeader } from '../src/lib/vehicles/car'
import { RETAIL_MP_VEHICLES, vehicleChoices, vehicleName } from '../src/lib/vehicles/client'
import { catalogs } from '../src/lib/catalogs'

// ---------------- a small car, written the way the game lays one out ----------------

class Writer {
  u8 = new Uint8Array(1 << 16)
  dv = new DataView(this.u8.buffer)
  u32(o: number, v: number) { this.dv.setUint32(o, v >>> 0) }
  u16(o: number, v: number) { this.dv.setUint16(o, v) }
  f32(o: number, v: number) { this.dv.setFloat32(o, v) }
}

interface MeshSpec { verts: number[][]; strip: number[]; mat: number; tags?: { name: string; pos: number[] }[] }

const enc10 = (v: number) => Math.round(v * 511) & 1023
/** A version-28 cmesh without a material table (as embedded in a car) at `at`; returns its end. */
function writeCmesh(w: Writer, at: number, m: MeshSpec): number {
  let cur = at
  const align = (a: number) => { const r = (cur - at) % a; if (r) cur += a - r }
  const take = (n: number, a = 1) => { align(a); const o = cur; cur += n; return o }
  w.u32(at, 0x424bd00d); w.u16(at + 4, 28); w.u16(at + 14, m.tags?.length ?? 0); w.u32(at + 44, 1)
  cur = at + 0x40; align(16); cur += 1
  if (m.tags?.length) {
    const o = take(m.tags.length * 96, 16)
    m.tags.forEach((t, i) => { [...t.name].forEach((c, k) => { w.u8[o + 96 * i + k] = c.charCodeAt(0) }); t.pos.forEach((v, k) => w.f32(o + 96 * i + 68 + 4 * k, v)); w.f32(o + 96 * i + 92, 1) })
  }
  const hd = take(56, 4); align(16)
  w.u16(hd + 28, 1)
  const rec = take(16, 16); w.u16(rec, 0x10); w.u16(rec + 2, 1)
  const sub = take(8, 16); w.u32(sub, 0); w.u16(sub + 4, m.strip.length); w.u16(sub + 6, m.mat)
  const s = take(88, 16); w.u16(s + 12, m.verts.length); w.u16(s + 14, m.strip.length); w.u16(s + 16, 32)
  take(0, 16); align(4096)
  const ib = take(m.strip.length * 2, 32)
  m.strip.forEach((v, i) => w.u16(ib + 2 * i, v))
  const vb = take(m.verts.length * 32, 32)
  m.verts.forEach((v, i) => {
    const o = vb + 32 * i
    v.forEach((x, k) => w.f32(o + 4 * k, x))
    w.u32(o + 12, enc10(0) | (enc10(1) << 10) | (enc10(0) << 20)) // normal +Y
    w.dv.setInt16(o + 20, 512); w.dv.setInt16(o + 22, -256) // uv (0.5, -0.25)
  })
  return cur
}

const quad = (cx: number, cy: number, cz: number, r: number): MeshSpec => ({ verts: [[cx - r, cy - r, cz], [cx + r, cy - r, cz], [cx - r, cy + r, cz], [cx + r, cy + r, cz]], strip: [0, 1, 2, 3], mat: 0 })

/** Body (one quad), a front-left wheel part placed by its record, a cap on the wheel (a part whose parent is a part). */
function smallCar(): Uint8Array {
  const w = new Writer()
  const texAt = 0x5000, matAt = 0x5100, body = 0x6000
  w.u32(4 * 11, 1); w.u32(4 * 12, texAt); w.u32(4 * 13, matAt); w.u32(4 * 15, body)
  w.u32(texAt, texAt + 8); [...'paint_d.tga'].forEach((c, i) => { w.u8[texAt + 8 + i] = c.charCodeAt(0) })
  // material table: one material with a diffuse_map slot
  w.u16(matAt, 1)
  const m = matAt + 16
  w.u32(m, 0x12345678); w.u32(m + 4, volitionHash('CarPaint')); w.u16(m + 10, 1)
  const slot = matAt + 80; w.u32(slot, volitionHash('diffuse_map')); w.u32(slot + 4, 0)
  // parts
  w.u32(0x98, 2)
  const part = (k: number, kind: number, parent: number, pos: number[], mesh: number) => {
    const r = 0x9c + 0x218 * k
    w.u32(r, kind); w.dv.setInt32(r + 8, parent)
    ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => w.f32(r + 0x14 + 4 * i, v))
    pos.forEach((v, i) => w.f32(r + 0x38 + 4 * i, v))
    w.u32(r + 0x44, mesh)
  }
  let end = writeCmesh(w, body, { ...quad(0, 0, 0, 1), tags: [{ name: 'driver', pos: [-0.4, 0.1, 0] }] })
  const wheel = Math.ceil(end / 64) * 64
  end = writeCmesh(w, wheel, quad(0, 0, 0, 0.35))
  const cap = Math.ceil(end / 64) * 64
  end = writeCmesh(w, cap, quad(0, 0, 0, 0.1))
  part(0, 2, -1, [-0.8, -0.4, 1.4], wheel)
  part(1, 6, 0, [-0.15, 0, 0], cap)
  return w.u8.slice(0, end)
}

describe('vehicle model reader', () => {
  it('reads the container: textures, the shared material table, the part records', () => {
    const h = readCarHeader(smallCar())
    expect(h.textures).toEqual(['paint_d.tga'])
    expect(h.materials).toHaveLength(1)
    expect(h.materials[0].slots).toEqual([{ slot: 'diffuse_map', texture: 'paint_d.tga' }])
    expect(h.parts.map((p) => [p.kind, p.parent])).toEqual([[2, -1], [6, 0]])
  })

  it('places every part in the car frame (a part on a part too) and finds the ground under the wheels', () => {
    const car = parseCar(smallCar())
    expect(car.meshes.map((m) => m.part)).toEqual([-1, 0, 1])
    const wheel = car.meshes[1], cap = car.meshes[2]
    expect([...wheel.positions.slice(0, 3)].map((v) => +v.toFixed(3))).toEqual([-1.15, -0.75, 1.4])
    expect([...cap.positions.slice(0, 3)].map((v) => +v.toFixed(3))).toEqual([-1.05, -0.5, 1.4])
    expect(car.wheelBottom).toBeCloseTo(-0.75, 5)
    expect(car.triangles).toBe(6)
    expect(car.tags.map((t) => t.name)).toEqual(['driver'])
    expect(wheel.groups).toEqual([{ start: 0, count: 6, material: 0 }])
    // normals turned with the part, UVs with v flipped for three.js
    expect([...wheel.normals.slice(0, 3)].map((v) => Math.round(v))).toEqual([0, 1, 0])
    expect([...wheel.uvs.slice(0, 2)]).toEqual([0.5, 0.25])
  })

  it('refuses other files', () => {
    expect(() => parseCar(new Uint8Array(4096))).toThrow(/not a vehicle model/)
  })
})

describe('vehicle variants', () => {
  const xml = `<root><Table><Mesh><Name>car_x</Name><Variants>
    <Variant><Name>Beater</Name><Weight>75</Weight><Variant_IDs>
      <Vid_group><Name>Hood</Name><Vid_chances><Vid_chance><VID_list>3</VID_list><Chance>100</Chance></Vid_chance></Vid_chances></Vid_group>
    </Variant_IDs></Variant>
    <Variant><Name>Standard</Name><Weight>20</Weight><Variant_IDs>
      <Vid_group><Name>Hood</Name><Vid_chances><Vid_chance><VID_list>1</VID_list><Chance>100</Chance></Vid_chance><Vid_chance><VID_list>2</VID_list><Chance>0</Chance></Vid_chance></Vid_chances></Vid_group>
      <Vid_group><Name>Bumpers</Name><Vid_chances><Vid_chance><VID_list>10 18</VID_list><Chance>60</Chance></Vid_chance><Vid_chance><VID_list>11</VID_list><Chance>40</Chance></Vid_chance></Vid_chances></Vid_group>
      <Vid_group><Name>Spoilers</Name><Vid_chances><Vid_chance><VID_list>30</VID_list><Chance>0</Chance></Vid_chance></Vid_chances></Vid_group>
    </Variant_IDs><Materials><Material_group><Name>Carpaint</Name><Material_chances>
      <Material_chance><Name>(CarPaint, CarPaint_Top)</Name><Chance>50</Chance></Material_chance>
      <Material_chance><Name>CarPaint_Dex</Name><Chance>50</Chance></Material_chance>
    </Material_chances></Material_group></Materials></Variant>
  </Variants></Mesh></Table></root>`

  it('reads the variant table and picks the clean look: Standard, each group\'s likeliest choice', () => {
    const vs = parseCarVariants(xml)
    expect(vs.map((v) => [v.name, v.weight])).toEqual([['Beater', 75], ['Standard', 20]])
    expect(defaultVariant(vs)).toEqual({ name: 'Standard', vids: [0, 1, 10, 18], materials: ['carpaint', 'carpaint_top'] })
    // without a Standard or Stock variant, the one seen most
    expect(defaultVariant(vs.slice(0, 1))!.vids).toEqual([0, 3])
    expect(defaultVariant([])).toBeNull()
  })

  it('draws the chosen pieces, one material per range (the variant\'s paint where a range offers several)', () => {
    const d = (start: number, count: number, mat: number) => ({ start, count, mat })
    const cmesh = { records: [{ subs: [d(0, 9, 0)] }], vids: [{ record: 0, vid: 0, draws: [d(0, 10, 0), d(0, 10, 5)] }, { record: 0, vid: 7, draws: [d(10, 4, 2)] }] } as unknown as Cmesh
    expect(chooseDraws(cmesh, 0, new Set([0]), new Set())).toEqual([d(0, 10, 0)])
    expect(chooseDraws(cmesh, 0, new Set([0, 7]), new Set([5]))).toEqual([d(0, 10, 5), d(10, 4, 2)])
    expect(chooseDraws({ ...cmesh, vids: [] }, 0, new Set([0]), new Set())).toEqual([d(0, 9, 0)])
  })

  it('lists the retail multiplayer four first, then every other vehicle by name', () => {
    const list = vehicleChoices()
    expect(list.slice(0, 4).map((v) => v.name)).toEqual(['Quota', 'Shogun', 'Raycaster', 'Hammerhead'])
    expect(list.slice(0, 4).every((v) => v.retail)).toBe(true)
    expect(list).toHaveLength(catalogs.vehicles.length)
    const rest = list.slice(4).map((v) => v.name)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    expect(vehicleName('CAR_2DR_SPORTS03')).toBe('Raycaster')
    expect(RETAIL_MP_VEHICLES).toEqual(['sp_metermaid01', 'car_4dr_standard08', 'car_2dr_sports03', 'car_2dr_muscle01'])
  })
})

// ---------------- the game's own vehicles, when there is a local install ----------------

const GAME = process.env.SR1_PACKFILES || 'C:/Games/SaintsReborn/dist/game/packfiles'
const haveGame = existsSync(GAME + '/cmesh_stream.vpp_xbox2')

describe.skipIf(!GAME_TESTS || !haveGame)('the vehicles of a local game install', () => {
  it('builds all 84 vehicles: textured, standing on their wheels, at their real size', async () => {
    const cm = await openVpp(await openAsBlob(GAME + '/cmesh_stream.vpp_xbox2'), 'cmesh_stream')
    const va = existsSync(GAME + '/variants.vpp_xbox2') ? await openVpp(await openAsBlob(GAME + '/variants.vpp_xbox2'), 'variants') : null
    const ids = cm.list().filter((n) => n.toLowerCase().endsWith('.car_xbox2')).map((n) => n.slice(0, -10).toLowerCase())
    expect(ids).toHaveLength(84)
    // every vehicle the picker offers is one of them
    for (const [, id] of catalogs.vehicles) expect(ids).toContain(id.toLowerCase())
    const pegfiles = existsSync(GAME + '/pegfiles.vpp_xbox2') ? await openVpp(await openAsBlob(GAME + '/pegfiles.vpp_xbox2'), 'pegfiles') : null
    const shared = pegfiles ? indexPeg(await pegfiles.read('always_loaded.peg_xbox2')) : null
    const sizes: Record<string, number[]> = {}

    for (const id of ids) {
      const xtbl = va?.has(id + '.xtbl') ? new TextDecoder('latin1').decode(await va.read(id + '.xtbl')) : ''
      const car = parseCar(await cm.read(id + '.car_xbox2'), xtbl ? defaultVariant(parseCarVariants(xtbl)) : null)
      const length = car.max[2] - car.min[2], width = car.max[0] - car.min[0], height = car.max[1] - (car.wheelBottom ?? car.min[1])
      sizes[id] = [length, width, height]
      // Sensible for a road vehicle (the police chopper is the long one, the airport truck the wide one).
      expect(length, id).toBeGreaterThan(2.5)
      expect(length, id).toBeLessThan(21)
      expect(width, id).toBeGreaterThan(1.2)
      expect(width, id).toBeLessThan(4.1)
      expect(height, id).toBeGreaterThan(1.2)
      expect(height, id).toBeLessThan(5)
      expect(length, id).toBeGreaterThan(width)
      expect(car.wheelBottom, id).not.toBeNull()
      expect(car.triangles, id).toBeGreaterThan(1500)
      // The pieces are where the body is: nothing stray far from the car.
      let far = 0
      for (const m of car.meshes) for (let i = 0; i < m.positions.length; i++) far = Math.max(far, Math.abs(m.positions[i]))
      expect(far, id).toBeLessThan(length + 1)
      // Most triangles draw with a picture: from the car's own texture file, or the one all cars share.
      const own = indexPeg(await cm.read(id + '.peg_xbox2'))
      let textured = 0
      const found = new Map<string, boolean>()
      for (const m of car.meshes) for (const g of m.groups) {
        const name = car.materials[g.material]?.slots.find((s) => s.slot === 'diffuse_map')?.texture?.toLowerCase() ?? ''
        // (a name kept only as a stand-in, like misc-white, counts: the game draws it as plain white too)
        if (!found.has(name)) found.set(name, !!findTexture(name, shared ? [own, shared] : [own]) || own.byName.has(name) || !!shared?.byName.has(name))
        if (found.get(name)) textured += g.count / 3
      }

      expect(textured / car.triangles, id).toBeGreaterThan(shared ? 0.8 : 0.25)
    }
    // the four from the retail multiplayer maps, in metres (length, width)
    const near = (id: string, l: number, w: number) => { expect(Math.abs(sizes[id][0] - l), id).toBeLessThan(0.4); expect(Math.abs(sizes[id][1] - w), id).toBeLessThan(0.25) }
    near('sp_metermaid01', 2.8, 1.4)
    near('car_4dr_standard08', 4.2, 2.0)
    near('car_2dr_sports03', 4.8, 2.05)
    near('car_2dr_muscle01', 4.65, 2.0)
    // classes: a compact is shorter than a limo, a semi taller than a sports car
    expect(sizes.car_2dr_compact04[0]).toBeLessThan(sizes.sp_limo01[0] - 3)
    expect(sizes.truck_2dr_semi01[2]).toBeGreaterThan(sizes.car_2dr_sports03[2] + 2)
  }, 300000)
})

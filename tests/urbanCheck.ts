// A street inspector for the built urban sample maps: finds the things a
// player notices as wrong. Cars across lanes or parked into kerbs, walls and
// each other; benches, bus stops and machines facing a wall; shop fronts and
// doors facing an alley or the map edge or blocked by props; props floating,
// sunk or inside other solids; traffic lights no driver could see; stairs and
// ramps that lead nowhere; crosswalks off the road; anything outside the
// walls. Used by urbanSanity.test.ts (REPORT=1 prints every finding).
import type { Vec3 } from '../src/lib/project'
import type { Part, Sample, Tex } from '../src/lib/sampleKit'
import { shapeObj } from '../src/lib/shapes'
import { Space, corners, heightAt, isFlat, penetration, toLocal, top, turnBy, yOverlap } from '../src/lib/sampleSpace'

export interface Finding { map: string; rule: string; what: string; at: [number, number]; detail: string }

interface Obj { id: number; key: string; parts: Part[]; at: Vec3; rot: number }

const f1 = (n: number) => +n.toFixed(1)

const ROAD_TEX = new Set<string>()
const asKey = (t: Tex) => JSON.stringify(t)
export function roadTextures(...ts: Tex[]) { for (const t of ts) ROAD_TEX.add(asKey(t)) }

/** Paint, films and decals. */
const FLAT = (p: Part) => isFlat(p) || /Crosswalk|Puddle|Manhole|Drain|Litter|Marking/.test(p.label)
/** Floors other things stand on (a kerb you step up). */
const FLOORLIKE = /^(Ground|Sidewalk|Path|Plaza|Road|Street|Highway|Driveway|Court|Half court|Football field|Platform|Track bed|Rail spur|Island|Pump island|Porch|Bank|Quay|Pier|Harbor floor|Canal bed|Riverbed|Graveyard|Cul-de-sac|Median|Traffic island|Loading dock|Station platform|Concourse|Portico|Floor \d|Parking deck|Low deck|High deck|Walkway|Footbridge|Bridge|Road bridge|Stage|Gazebo floor|Kerb|Lot|Yard|Lawn|Floor ruin)$/
const VEHICLE = /^(car|citybus|boxtruck|cementmixer|foodtruck|Bus|Crashed bus|Car|Food truck|Truck trailer|Van|Limo|Forklift|forklift|taxi|policecar|pickup|van|schoolbus)$/
const WRECK = /^(carwreck|Crushed cars)$/
/** Pieces with a front (local +Z) that people use: they must not face a wall. */
const FACING = /^(bench|Bench|busstop|Bus stop|vending|Vending|atm|ATM|kiosk|Kiosk|stall|Stall|newsbox|cafe|icemachine|payphone)$/
/** Trim bands and panels on a building's face: a stair or sign brushing them is fine. */
const TRIM = /^(Ledge|Cornice|Parapet|Storefront|Door|Roll-up door|Neon sign)$/
/** Pieces made to sit in each other. */
const TOGETHER: [RegExp, RegExp][] = [[/^Church$/, /^Bell tower$/], [/^Goal post$/, /^Crossbar$/], [/^Road bridge$/, /^Bridge pier$/], [/^Stadium$/, /^Concourse$/], [/^Broken wall$/, /^Broken wall$/], [/^Chimney$/, /^Roof$/]]

/** Every object in the map: prefab groups as one, loose parts each on their own. */
function objects(parts: Part[]): Obj[] {
  const byGroup = new Map<string, Part[]>()
  const out: Obj[] = []
  for (const p of parts) {
    if (!p.group) { out.push({ id: out.length, key: p.label, parts: [p], at: p.at, rot: p.rot ?? 0 }); continue }
    if (!byGroup.has(p.group)) { byGroup.set(p.group, []); out.push({ id: out.length, key: '', parts: byGroup.get(p.group)!, at: p.at, rot: 0 }) }
    byGroup.get(p.group)!.push(p)
  }
  for (const o of out) {
    const p0 = o.parts[0]
    if (!p0.group) continue
    if (p0.prefab) { o.key = p0.prefab.key; o.at = p0.prefab.at; o.rot = p0.prefab.rot }
    else { o.key = p0.group!.split('@')[0]; o.at = [...p0.at] as Vec3; o.rot = p0.rot ?? 0 }
  }
  return out
}

const isBuilding = (o: Obj) => o.key === 'shop'
const isStructure = (p: Part) => FLOORLIKE.test(p.label) || p.label === 'Wall' || Math.max(p.size[0], p.size[2]) >= 40
/** A post or leg standing up through a deck or into its underside. */
const post = (a: Part, b: Part) => Math.max(a.size[0], a.size[2]) <= 2.5 && a.size[1] > Math.max(a.size[0], a.size[2]) && a.at[1] < b.at[1] && top(a) <= top(b) + 1.5

export function inspect(s: Sample): Finding[] {
  const out: Finding[] = []
  const objs = objects(s.parts)
  const objOf = new Map<Part, Obj>()
  for (const o of objs) for (const p of o.parts) objOf.set(p, o)
  const space = new Space(s.parts)
  const not = (o?: Obj) => (p: Part) => objOf.get(p) === o
  const say = (rule: string, o: Obj | Part, detail: string) => {
    const at = o.at
    // Each problem has a mirrored twin on blue's half: report red's.
    if (at[2] > 0.01 || (Math.abs(at[2]) <= 0.01 && at[0] > 0.01)) return
    out.push({ map: s.id, rule, what: 'parts' in o ? o.key : o.label, at: [f1(at[0]), f1(at[2])], detail })
  }
  const roadAt = (x: number, z: number, maxY = 60) => { const f = space.floorAt(x, z, maxY); return !!f.by && ROAD_TEX.has(asKey(f.by.top)) }

  // 1. Inside the walls.
  const walls = s.parts.filter((p) => p.label === 'Wall' && Math.max(p.size[0], p.size[2]) >= 100 && p.at[1] <= 0)
  if (walls.length >= 4) {
    const zs = walls.filter((w) => w.size[0] > w.size[2]), xs = walls.filter((w) => w.size[2] > w.size[0])
    const b = {
      x0: Math.max(...xs.filter((w) => w.at[0] < 0).map((w) => w.at[0] + w.size[0] / 2)), x1: Math.min(...xs.filter((w) => w.at[0] > 0).map((w) => w.at[0] - w.size[0] / 2)),
      z0: Math.max(...zs.filter((w) => w.at[2] < 0).map((w) => w.at[2] + w.size[2] / 2)), z1: Math.min(...zs.filter((w) => w.at[2] > 0).map((w) => w.at[2] - w.size[2] / 2)),
    }
    for (const o of objs) {
      if (o.parts.some((p) => walls.includes(p))) continue
      let worst = 0
      for (const p of o.parts) {
        if (TRIM.test(p.label) || p.at[1] > 12) continue
        for (const [x, z] of corners(p)) worst = Math.max(worst, b.x0 - x, x - b.x1, b.z0 - z, z - b.z1)
      }
      if (worst > 0.15) say('outside', o, `pokes ${f1(worst)} units through the outer wall`)
    }
  }

  // 2. Bodies inside other bodies, and props sunk into kerbs.
  const seen = new Set<string>()
  for (const a of s.parts) {
    if (FLAT(a) && !isFlat(a)) continue
    const oa = objOf.get(a)!
    for (const b of space.around(a)) {
      if (b === a || (FLAT(b) && !isFlat(b)) || objOf.get(b) === oa) continue
      const ob = objOf.get(b)!
      const pair = oa.id < ob.id ? `${oa.id}:${ob.id}` : `${ob.id}:${oa.id}`
      if (seen.has(pair)) continue
      // Two surfaces at the same height over the same spot flicker as the camera moves.
      if (Math.abs(top(a) - top(b)) < 0.01 && a.kind !== 'cylinder' && b.kind !== 'cylinder' && penetration(a, b) > 0.3 && !seen.has('f' + pair)) {
        seen.add('f' + pair)
        say('flicker', oa, `${a.label} and ${b.label} (${ob.key}) share their top surface at height ${f1(top(a))}`)
      }
      if (FLAT(a) || FLAT(b)) continue
      const dy = yOverlap(a, b)
      if (dy <= 0.05) continue
      const pen = penetration(a, b)
      if (pen <= 0.2) continue
      if (TOGETHER.some(([m, n]) => (m.test(a.label) && n.test(b.label)) || (m.test(b.label) && n.test(a.label)))) continue
      if (post(a, b) || post(b, a)) continue
      // Something standing a little into a floor or kerb: sunk.
      const sa = isStructure(a), sb = isStructure(b)
      if (sa !== sb) {
        const [lo, hi] = sa ? [a, b] : [b, a]
        if (top(lo) - hi.at[1] <= 0.7 && hi.at[1] >= lo.at[1] - 0.01) {
          seen.add(pair)
          // A building's door or shop window meeting the kerb it opens onto is fine.
          if (!TRIM.test(hi.label)) say('sunk', objOf.get(hi)!, `stands ${f1(top(lo) - hi.at[1])} units into ${lo.label}`)
          continue
        }
      }
      if (sa && sb) continue
      if (dy <= 0.25) continue
      if ((TRIM.test(a.label) || TRIM.test(b.label)) && pen <= 0.65) continue
      seen.add(pair)
      const [x, y] = [oa, ob].sort((m, n) => (isBuilding(m) ? 1 : 0) - (isBuilding(n) ? 1 : 0) || m.parts.length - n.parts.length)
      say('overlap', x, `${(x === oa ? a : b).label} is ${f1(pen)} units inside ${(y === oa ? a : b).label} (${y.key} at ${f1(y.at[0])}, ${f1(y.at[2])})`)
    }
  }

  // 3. Floating props (loose pieces and prefabs, not the map's structure).
  for (const o of objs) {
    if (o.parts.every(isStructure) || o.parts.some((p) => p.label === 'Wall')) continue
    const base = Math.min(...o.parts.map((p) => p.at[1]))
    const low = o.parts.filter((p) => p.at[1] <= base + 0.05 && !FLAT(p))
    if (!low.length) continue
    // Held up from the side (signs, awnings, lines strung between walls): some part touches something.
    const leaning = o.parts.some((p) => !p.water && !p.fit && space.around(p).some((q) => objOf.get(q) !== o && !FLAT(q) && yOverlap(p, q) > -0.05 && penetration(p, q, 0.3) > 0))
    const spots = low.flatMap((p) => [[p.at[0], p.at[2]] as [number, number], ...corners(p, 0.3)])
    const gap = base - Math.max(...spots.map(([x, z]) => space.floorAt(x, z, base + 0.05, not(o)).y))
    if (gap > 0.2 && !leaning) say('floating', o, Number.isFinite(gap) ? `hangs ${f1(gap)} units above the floor` : 'has nothing under it')
  }

  // 4. Vehicles: square to the street, and parked with the kerb on their right (local −X).
  const looseParking = /junkyard|ruins|trailer/.test(s.id)
  for (const o of objs) {
    if (!VEHICLE.test(o.key) || WRECK.test(o.key)) continue
    const r = ((o.rot % 90) + 90) % 90
    const skew = Math.min(r, 90 - r)
    if (skew > 4 && !looseParking && !/crash/i.test(o.key)) say('vehicle', o, `turned ${f1(skew)}° off the street grid`)
    const body = o.parts.reduce((m, p) => (p.size[0] * p.size[2] > m.size[0] * m.size[2] ? p : m), o.parts[0])
    const hw = Math.min(body.size[0], body.size[2]) / 2
    const kerb = (sx: number) => {
      for (let d = hw + 0.2; d < hw + 2.6; d += 0.4) for (const dz of [-2, 0, 2]) {
        const [ox, oz] = turnBy(sx * d, dz, o.rot)
        const x = o.at[0] + ox, z = o.at[2] + oz
        if (space.floorAt(x, z, o.at[1] + 1.5).y > o.at[1] + 0.15 || space.solidAt(x, o.at[1] + 1, z, not(o))) return true
      }
      return false
    }
    if (!looseParking && kerb(1) && !kerb(-1) && roadAt(o.at[0], o.at[2], o.at[1] + 0.1)) say('vehicle', o, 'parked against the traffic (kerb on its left)')
  }

  // 5. Benches, shelters, machines and kiosks must face somewhere you can stand.
  for (const o of objs) {
    const shelter = o.key === 'Shelter back'
    if (!FACING.test(o.key) && !shelter) continue
    const base = Math.min(...o.parts.map((p) => p.at[1]))
    const reach = shelter ? 1.6 : Math.max(...o.parts.map((p) => toLocal({ ...p, at: o.at, rot: o.rot }, p.at[0], p.at[2])[1] + p.size[2] / 2))
    let blocked: Part | undefined
    for (let d = reach + 0.4; d <= reach + 2.4 && !blocked; d += 0.5) for (const dx of [-0.8, 0, 0.8]) {
      const [ox, oz] = turnBy(dx, d, o.rot)
      blocked ??= space.solidAt(o.at[0] + ox, base + 1.2, o.at[2] + oz, not(o))
    }
    if (blocked) say('facing', o, `faces ${blocked.label}${objOf.get(blocked) ? ` (${objOf.get(blocked)!.key})` : ''} right in front of it`)
  }

  // 6. Building fronts: open to a street or square, not an alley, a wall or the map edge, and not blocked.
  for (const o of objs) {
    if (o.key !== 'shop' || !o.parts[0].prefab) continue
    const pr = o.parts[0].prefab.params
    const front = String(pr.front), w = +pr.w, d = +pr.d
    const rot = ({ S: 0, N: 180, E: 90, W: 270 } as Record<string, number>)[front]
    const depth = front === 'N' || front === 'S' ? d : w
    const base = o.at[1]
    let clear = 0, stop: Part | undefined
    for (let dz = depth / 2 + 0.6; dz <= depth / 2 + 14 && !stop; dz += 0.5) {
      for (const dx of [-1.5, 0, 1.5]) {
        const [ox, oz] = turnBy(dx, dz, rot)
        const x = o.at[0] + ox, z = o.at[2] + oz
        // The floor in front may be a kerb, steps or a loading dock.
        stop ??= space.solidAt(x, space.floorAt(x, z, base + 4.5).y + 1.2, z, not(o))
      }
      if (!stop) clear = dz - depth / 2
    }
    if (clear < 6) say('front', o, `front (${front}) opens onto only ${f1(clear)} units before ${stop ? `${stop.label} (${objOf.get(stop)?.key})` : 'nothing'}`)
  }

  // 7. Stairs and ramps: a floor at the bottom, a floor (or a ledge you can climb) at the top.
  for (const p of s.parts) {
    if ((p.kind !== 'stairs' && p.kind !== 'ramp') || p.label === 'Bleachers' || (p.group && !/^(Stairs|Ramp|Steps)$/.test(p.label))) continue
    // Steps inside a prefab lead to the rest of it (a trailer's door): only the steps themselves are skipped.
    const o = p.group ? undefined : objOf.get(p)!
    const not = (q?: Obj) => (r: Part) => (q ? objOf.get(r) === q : r === p)
    const end = (lz: number): [number, number] => { const [ox, oz] = turnBy(0, lz, p.rot ?? 0); return [p.at[0] + ox, p.at[2] + oz] }
    const [tx, tz] = end(-p.size[2] / 2 - 0.6)
    const want = top(p)
    const f = space.floorAt(tx, tz, want + 1.2, not(o))
    const wall = space.solidAt(tx, want + 1.2, tz, not(o))
    // Up to a door is fine: a door is where steps go.
    const door = s.parts.some((q) => /door/i.test(q.label) && Math.hypot(q.at[0] - tx, q.at[2] - tz) < 2.5 && Math.abs(q.at[1] - want) < 1)
    if (wall && (heightAt(wall, tx, tz) ?? 0) > want + 1.3) { if (!door) say('stairs', p, `top end runs into ${wall.label}`) }
    else if (f.y < want - 0.4) say('stairs', p, `top end (height ${f1(want)}) leads nowhere: ${Number.isFinite(f.y) ? `${f1(want - f.y)} unit drop` : 'no floor'}`)
    const [bx, bz] = end(p.size[2] / 2 + 0.6)
    const g = space.floorAt(bx, bz, p.at[1] + 0.4, not(o))
    const block = space.solidAt(bx, p.at[1] + 1, bz, not(o))
    if (Math.abs(g.y - p.at[1]) > 0.4) say('stairs', p, `bottom end ${Number.isFinite(g.y) ? `is ${f1(p.at[1] - g.y)} units above the floor` : 'has no floor'}`)
    else if (block) say('stairs', p, `bottom end is blocked by ${block.label}`)
  }

  // 8. Crosswalks on a road.
  for (const p of s.parts.filter((q) => q.label === 'Crosswalk')) {
    const f = space.floorAt(p.at[0], p.at[2], p.at[1] + 0.02, not(objOf.get(p)))
    if (!f.by || !ROAD_TEX.has(asKey(f.by.top)) || Math.abs(f.y - p.at[1]) > 0.05) say('crosswalk', p, `painted on ${f.by?.label ?? 'nothing'}, not a road`)
  }

  // 9. Traffic signals hang over the road, facing along it.
  for (const o of objs) {
    if (o.key !== 'trafficlight' && o.key !== 'signal') continue
    const own = not(o)
    const ground = (x: number, z: number, y: number) => { const f = space.floorAt(x, z, y, own); return !!f.by && ROAD_TEX.has(asKey(f.by.top)) }
    for (const head of o.parts.filter((p) => /Signal head/.test(p.label))) {
      if (!ground(head.at[0], head.at[2], head.at[1])) { say('signal', o, 'signal head is not over the road'); break }
      // The lights look the way their red lamp sits on the head; drivers coming from there need road to come along.
      const red = o.parts.filter((p) => p.label === 'Red').sort((a, b) => Math.hypot(a.at[0] - head.at[0], a.at[2] - head.at[2]) - Math.hypot(b.at[0] - head.at[0], b.at[2] - head.at[2]))[0]
      if (!red) continue
      const dx = red.at[0] - head.at[0], dz = red.at[2] - head.at[2], l = Math.hypot(dx, dz) || 1
      if (!ground(head.at[0] + (dx / l) * 8, head.at[2] + (dz / l) * 8, head.at[1])) { say('signal', o, 'its lights face away from the road'); break }
    }
  }
  return out
}

const triCache = new Map<string, number>()
/** Triangles a map draws (shapes fan-triangulated). */
export function triangles(s: Sample): number {
  let n = 0
  for (const p of s.parts) {
    const shape = { kind: p.kind, size: p.size, tile: p.tile ?? 4, segments: p.segments, taper: p.taper, bevel: p.bevel, lie: p.lie, outline: p.outline, cells: p.cells, heights: p.heights }
    const k = JSON.stringify(shape)
    let t = triCache.get(k)
    if (t === undefined) {
      t = 0
      for (const line of shapeObj(shape as never).split('\n')) if (line.startsWith('f ')) t += line.split(' ').length - 3
      triCache.set(k, t)
    }
    n += t
  }
  return n
}

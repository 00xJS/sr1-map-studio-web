// Decoy dummies without the game: the poses, a plain stand-in figure of the site's own making, and the body boxes
// every dummy collides with. Pure module (share links and the Showcase rebuild the stand-in from its recipe).
//
// A dummy in a map is one object: its look (the posed character from the player's own game, or this stand-in when
// the game's files can't go there) drawn but not solid, and a set of boxes around the body, one per limb, that are
// solid but drawn with an invisible texture. Bullets and players stop where the body is, and the boxes never carry
// game data, so they go wherever the map goes.
//
// Space: metres, feet on the ground at the origin, facing -Z (the character's right is +X), as the walk-through's
// player; the OBJ is written in editor units (metres / world scale).

export type V3 = [number, number, number]

export const POSES = {
  standing: 'Standing',
  relaxed: 'Relaxed',
  crouch: 'Crouching',
  aim: 'Aiming a pistol',
  mannequin: 'Arms out (shop window)',
} as const
export type PoseId = keyof typeof POSES
export const POSE_IDS = Object.keys(POSES) as PoseId[]
export const isPose = (p: unknown): p is PoseId => typeof p === 'string' && Object.hasOwn(POSES, p)

export type JointName =
  | 'pelvis' | 'chest' | 'neck' | 'head'
  | 'lShoulder' | 'lElbow' | 'lWrist' | 'rShoulder' | 'rElbow' | 'rWrist'
  | 'lHip' | 'lKnee' | 'lAnkle' | 'lToe' | 'rHip' | 'rKnee' | 'rAnkle' | 'rToe'
export type Joints = Record<JointName, V3>

/** The solid boxes' material (an invisible texture, Flesh surface); every other material of a dummy is look only. */
export const BODY_MAT = 'dummy_body'
/** The stand-in's own materials, by the part of the body they cover. */
export const STAND_IN_MATS = { skin: 'dummy_skin', top: 'dummy_top', legs: 'dummy_legs', shoes: 'dummy_shoes' } as const
export type StandInPart = keyof typeof STAND_IN_MATS
/** Flesh, in the game's list of physical materials (catalogs.surface_types). */
export const FLESH_SURFACE = 6

// ---------------- vectors ----------------

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const rad = (d: number) => (d * Math.PI) / 180

// ---------------- the stand-in's skeleton ----------------
// Plain adult proportions (metres), not measured from any game file.
const BODY = { hip: 0.95, hipHalf: 0.1, spine: 0.47, neck: 0.08, head: 0.17, shoulderHalf: 0.19, shoulderDrop: 0.05, upperArm: 0.29, foreArm: 0.26, thigh: 0.45, calf: 0.43, ankle: 0.08, foot: 0.17 }

/**
 * A limb hanging from its joint, turned `forward` degrees towards the front and `out` degrees away from the body
 * (side: -1 left, +1 right). 0, 0 points straight down.
 */
const limb = (forward: number, out: number, side: number): V3 => {
  const p = rad(forward), r = rad(out)
  return [side * Math.sin(r) * Math.cos(p), -Math.cos(r) * Math.cos(p), -Math.sin(p)]
}

interface FigurePose {
  lean: number
  arm: [number, number]; fore: [number, number]
  rArm?: [number, number]; rFore?: [number, number]
  thigh: [number, number]; calf: [number, number]
}
const FIGURE_POSES: Record<PoseId, FigurePose> = {
  standing: { lean: 0, arm: [2, 9], fore: [10, 4], thigh: [0, 3], calf: [0, 1] },
  relaxed: { lean: 0, arm: [0, 4], fore: [4, 2], thigh: [0, 2], calf: [0, 1] },
  crouch: { lean: 25, arm: [35, 10], fore: [75, 5], thigh: [80, 10], calf: [-15, 4] },
  aim: { lean: 0, arm: [2, 9], fore: [10, 4], rArm: [84, 6], rFore: [88, 2], thigh: [0, 5], calf: [0, 2] },
  mannequin: { lean: 0, arm: [0, 45], fore: [0, 48], thigh: [0, 3], calf: [0, 1] },
}

/** The stand-in's joints in a pose (metres, feet on the ground). */
export function figureJoints(pose: PoseId): Joints {
  const f = FIGURE_POSES[pose]
  const B = BODY
  const up: V3 = [0, Math.cos(rad(f.lean)), -Math.sin(rad(f.lean))]
  const legs = (side: number) => {
    const hip: V3 = [side * B.hipHalf, 0, 0]
    const knee = add(hip, mul(limb(f.thigh[0], f.thigh[1], side), B.thigh))
    const ankle = add(knee, mul(limb(f.calf[0], f.calf[1], side), B.calf - B.ankle))
    return { hip, knee, ankle }
  }
  const L = legs(-1), R = legs(1)
  // Hips high enough that the lower ankle is at ankle height.
  const lift = B.ankle - Math.min(L.ankle[1], R.ankle[1])
  const pelvis: V3 = [0, lift, 0]
  const at = (p: V3) => add(p, pelvis)
  const chest = add(pelvis, mul(up, B.spine))
  const neck = add(chest, mul(up, B.neck))
  const head = add(neck, mul(up, B.head))
  const arms = (side: number, arm: [number, number], fore: [number, number]) => {
    const shoulder = add(chest, [side * B.shoulderHalf, -B.shoulderDrop, 0])
    const elbow = add(shoulder, mul(limb(arm[0], arm[1], side), B.upperArm))
    const wrist = add(elbow, mul(limb(fore[0], fore[1], side), B.foreArm))
    return { shoulder, elbow, wrist }
  }
  const la = arms(-1, f.arm, f.fore), ra = arms(1, f.rArm ?? f.arm, f.rFore ?? f.fore)
  const toe = (ankle: V3): V3 => [ankle[0], 0.02, ankle[2] - B.foot]
  const lAnkle = at(L.ankle), rAnkle = at(R.ankle)
  return {
    pelvis, chest, neck, head,
    lShoulder: la.shoulder, lElbow: la.elbow, lWrist: la.wrist, rShoulder: ra.shoulder, rElbow: ra.elbow, rWrist: ra.wrist,
    lHip: at(L.hip), lKnee: at(L.knee), lAnkle, lToe: toe(lAnkle), rHip: at(R.hip), rKnee: at(R.knee), rAnkle, rToe: toe(rAnkle),
  }
}

// ---------------- boxes ----------------

/** A box along a segment: from `a` to `b`, `w` wide (across the body) and `d` deep, each tapering to `w2`/`d2` at `b`. */
export interface Segment { a: V3; b: V3; w: number; d: number; w2?: number; d2?: number; part: StandInPart }

/** The body as boxes, one per limb (13), from any set of joints. */
export function bodySegments(j: Joints): Segment[] {
  const mid = (a: V3, b: V3, k = 0.5): V3 => add(a, mul(sub(b, a), k))
  const hipMid = mid(j.lHip, j.rHip)
  const headUp = norm(sub(j.head, j.neck))
  const hand = (e: V3, w: V3) => add(w, mul(norm(sub(w, e)), 0.09))
  const foot = (ankle: V3, toe: V3): Segment => {
    const ground: V3 = [ankle[0], 0, ankle[2]], tip: V3 = [toe[0], 0, toe[2]]
    // Heel to toe along the ground, as high as the ankle.
    const heel = add(ground, mul(norm(sub(ground, tip)), 0.05))
    const h = Math.max(0.1, ankle[1] + 0.02)
    return { a: add(heel, [0, h / 2, 0]), b: add(tip, [0, h / 2, 0]), w: 0.1, d: h, part: 'shoes' }
  }
  return [
    { a: add(hipMid, [0, -0.1, 0]), b: add(hipMid, [0, 0.12, 0]), w: 0.34, d: 0.22, part: 'legs' },
    { a: add(hipMid, [0, 0.1, 0]), b: j.neck, w: 0.3, d: 0.2, w2: 0.4, d2: 0.24, part: 'top' },
    { a: j.neck, b: add(j.head, mul(headUp, 0.12)), w: 0.19, d: 0.23, part: 'skin' },
    { a: j.lShoulder, b: j.lElbow, w: 0.11, d: 0.11, w2: 0.09, d2: 0.09, part: 'top' },
    { a: j.rShoulder, b: j.rElbow, w: 0.11, d: 0.11, w2: 0.09, d2: 0.09, part: 'top' },
    { a: j.lElbow, b: hand(j.lElbow, j.lWrist), w: 0.09, d: 0.09, w2: 0.07, d2: 0.05, part: 'skin' },
    { a: j.rElbow, b: hand(j.rElbow, j.rWrist), w: 0.09, d: 0.09, w2: 0.07, d2: 0.05, part: 'skin' },
    { a: j.lHip, b: j.lKnee, w: 0.17, d: 0.18, w2: 0.12, d2: 0.13, part: 'legs' },
    { a: j.rHip, b: j.rKnee, w: 0.17, d: 0.18, w2: 0.12, d2: 0.13, part: 'legs' },
    { a: j.lKnee, b: j.lAnkle, w: 0.12, d: 0.13, w2: 0.08, d2: 0.09, part: 'legs' },
    { a: j.rKnee, b: j.rAnkle, w: 0.12, d: 0.13, w2: 0.08, d2: 0.09, part: 'legs' },
    foot(j.lAnkle, j.lToe), foot(j.rAnkle, j.rToe),
  ]
}

/** A segment's 8 corners: the 4 at `a` then the 4 at `b`, each (-w,-d) (+w,-d) (+w,+d) (-w,+d). */
export function segmentCorners(s: Segment): V3[] {
  const axis = norm(sub(s.b, s.a))
  // Across the body: the character's right (+X), or its front when the limb points sideways.
  let side: V3 = Math.abs(axis[0]) > 0.9 ? [0, 0, -1] : [1, 0, 0]
  side = norm(sub(side, mul(axis, dot(side, axis))))
  const depth = cross(axis, side)
  const ring = (c: V3, w: number, d: number): V3[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => add(c, add(mul(side, (u * w) / 2), mul(depth, (v * d) / 2))))
  return [...ring(s.a, s.w, s.d), ...ring(s.b, s.w2 ?? s.w, s.d2 ?? s.d)]
}

// The 6 sides as corner quads, wound so the faces point out (see segmentCorners' order).
const QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
// Each quad's picture: the whole texture.
const QUAD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]]

/** Triangles per segment box. */
export const BOX_TRIANGLES = 12

/**
 * OBJ text for segment boxes: `mat` names each box's material (by its body part). Editor units (metres / `ws`), with
 * a normal per face, so each box reads as a solid block.
 */
export interface ObjStart { v: number; vt: number; vn: number }
export function boxesObj(segments: Segment[], mat: (part: StandInPart) => string, ws: number, title: string, start: ObjStart = { v: 1, vt: 1, vn: 1 }): { text: string; next: ObjStart } {
  const f = (v: number) => +(v / ws).toFixed(4)
  const lines: string[] = ['# ' + title]
  const byMat = new Map<string, string[]>()
  let { v, vt, vn } = start
  const verts: string[] = [], uvs: string[] = [], nrms: string[] = []
  for (const s of segments) {
    const c = segmentCorners(s)
    const centre = mul(c.reduce((a, b) => add(a, b), [0, 0, 0] as V3), 1 / 8)
    const faces: string[] = []
    for (const q of QUADS) {
      // The face's own normal, flipped out if a tapered or degenerate box turned it.
      let n = norm(cross(sub(c[q[1]], c[q[0]]), sub(c[q[2]], c[q[0]])))
      const fc = mul(add(add(c[q[0]], c[q[1]]), add(c[q[2]], c[q[3]])), 0.25)
      const flip = dot(n, sub(fc, centre)) < 0
      if (flip) n = mul(n, -1)
      const ids = q.map((k, i) => {
        verts.push(`v ${f(c[k][0])} ${f(c[k][1])} ${f(c[k][2])}`)
        uvs.push(`vt ${QUAD_UV[i][0]} ${QUAD_UV[i][1]}`)
        return v++
      })
      nrms.push(`vn ${+n[0].toFixed(4)} ${+n[1].toFixed(4)} ${+n[2].toFixed(4)}`)
      const t = vt, nn = vn
      vt += 4; vn += 1
      const corner = (k: number) => `${ids[k]}/${t + k}/${nn}`
      const tri = flip ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]]
      for (const [a, b, cc] of tri) faces.push(`f ${corner(a)} ${corner(b)} ${corner(cc)}`)
    }
    const m = mat(s.part)
    byMat.set(m, [...(byMat.get(m) ?? []), ...faces])
  }
  lines.push(...verts, ...uvs, ...nrms)
  for (const [m, faces] of byMat) lines.push('usemtl ' + m, ...faces)
  return { text: lines.join('\n') + '\n', next: { v, vt, vn } }
}

/** The body boxes alone (the solid part of every dummy), for any joints. */
export const bodyObj = (j: Joints, ws: number, start?: ObjStart) => boxesObj(bodySegments(j), () => BODY_MAT, ws, 'Body boxes (solid, not drawn)', start)

/**
 * The stand-in: a plain figure in the pose (drawn, not solid) and its body boxes (solid, not drawn). What a dummy
 * looks like wherever the game's files can't go: share links, the Showcase, the hub, and an editor without them.
 */
export function standInObj(pose: PoseId, ws: number): string {
  const j = figureJoints(pose)
  // The look a touch slimmer than the boxes, so the invisible boxes are what a shot hits.
  const look = bodySegments(j).map((s) => ({ ...s, w: s.w * 0.92, d: s.d * 0.92, w2: (s.w2 ?? s.w) * 0.92, d2: (s.d2 ?? s.d) * 0.92 }))
  const fig = boxesObj(look, (p) => STAND_IN_MATS[p], ws, 'Decoy dummy stand-in (made by SR1 Map Studio)')
  return fig.text + bodyObj(j, ws, fig.next).text
}

/** Valid world scales for a stand-in recipe. */
export const validFigureScale = (ws: unknown) => typeof ws === 'number' && Number.isFinite(ws) && ws >= 0.05 && ws <= 10

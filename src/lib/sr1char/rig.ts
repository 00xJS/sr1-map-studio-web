// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Saints Row (2006) skeleton (.rig_xbox2), as used by the player body (pc.rig_xbox2 in preload.vpp_xbox2).
// Header (big-endian u32 at 0x20): version 4, bone count, ...; bone records of 36 bytes from 0x140:
// {u32 name offset, float inverse-bind translation xyz (= -rest position), float local offset from parent xyz,
//  u32 parent index (0xFFFFFFFF for the root), u32 0xFFFFFFFF}. Rest orientations are identity, so a pose is a set
// of rotations about each bone's rest position. Names are NUL-terminated strings after the records.
import * as THREE from 'three'

export interface RigBone { name: string; rest: THREE.Vector3; parent: number }
export interface Rig { bones: RigBone[]; byName: Record<string, number> }

export function parseRig(u8: Uint8Array): Rig {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const n = dv.getUint32(0x24)
  const REC = 0x140, SZ = 36
  // names: the first record is the root, whose name is "Root"; locate the name table from it
  let rootAt = -1
  for (let i = REC + n * SZ; i < u8.length - 4; i++) if (u8[i] === 82 && u8[i + 1] === 111 && u8[i + 2] === 111 && u8[i + 3] === 116 && u8[i + 4] === 0) { rootAt = i; break }
  if (rootAt < 0) throw new Error('rig has no Root bone')
  const nameBase = rootAt - dv.getUint32(REC)
  const str = (o: number) => { let s = ''; for (let i = nameBase + o; u8[i]; i++) s += String.fromCharCode(u8[i]); return s }
  const bones: RigBone[] = []
  for (let i = 0; i < n; i++) {
    const o = REC + SZ * i, par = dv.getUint32(o + 28)
    bones.push({ name: str(dv.getUint32(o)), rest: new THREE.Vector3(-dv.getFloat32(o + 4), -dv.getFloat32(o + 8), -dv.getFloat32(o + 12)), parent: par === 0xffffffff ? -1 : par })
  }
  return { bones, byName: Object.fromEntries(bones.map((b, i) => [b.name, i])) }
}

// The creator's standing pose. The creator holds one fixed pose (it did not change over minutes of watching), read
// from the running game: the 64 skinning matrices it uploads for the player draws (model space, exact bone lengths)
// turned into local rotations about each joint, quaternions [x, y, z, w] in the game's (unmirrored) model space.
// Includes the body turn (Root 10.9 degrees), the head tilt and the relaxed hands; bones not listed stay at rest.
// With CREATOR_OFFSET (the Root and Spine joints are also moved, by 0.8 and 7 mm) the matrices match the game's to 1e-5.
export const CREATOR_OFFSET: Record<string, [number, number, number]> = { 'Root': [0, 0.00075, 0], 'Spine': [-0.00700, -0.00050, 0.00175] }
const CREATOR_POSE: Record<string, [number, number, number, number]> = {
  'Root': [0.00000, 0.09455, 0.00000, 0.99552], 'Pelvis': [0.02124, -0.00079, 0.03723, 0.99908],
  'Spine': [0.01288, -0.03351, 0.02094, 0.99914], 'L-Thigh': [-0.12526, -0.14611, -0.04671, 0.98019],
  'R-Thigh': [-0.01673, 0.02771, -0.09751, 0.99471], 'Spine1': [0.03235, -0.02417, -0.01282, 0.99910],
  'L-Calf': [0.09723, -0.01440, 0.00110, 0.99516], 'R-Calf': [0.00964, 0.00140, -0.00012, 0.99995],
  'Spine2': [0.01947, -0.01569, -0.02747, 0.99931], 'L-Foot': [0.00488, 0.10383, -0.01911, 0.99440],
  'R-Foot': [-0.01856, 0.11597, 0.07312, 0.99038], 'L-Clavicle': [0.00836, -0.05719, -0.07141, 0.99577],
  'Neck': [-0.13184, -0.05140, -0.03815, 0.98920], 'R-Clavicle': [0.00116, -0.03278, 0.05078, 0.99817],
  'L-Toe0': [-0.00409, -0.00000, -0.00043, 0.99999], 'R-Toe0': [-0.00757, 0.00000, 0.00079, 0.99997],
  'L-UpperArmTwist1': [-0.08959, 0.11338, 0.23418, 0.96139], 'Head': [0.07300, 0.01874, 0.00983, 0.99711],
  'R-UpperArmTwist1': [-0.02646, -0.04148, -0.16442, 0.98516],
  'L-UpperArmTwist2': [0.02399, 0.02625, 0.00122, 0.99937],
  'R-UpperArmTwist2': [0.01343, -0.01465, -0.00067, 0.99980], 'L-ForeTwist': [-0.13996, 0.03150, 0.02008, 0.98945],
  'R-ForeTwist': [-0.10371, -0.10633, -0.00293, 0.98890], 'L-ForeTwist1': [-0.06476, -0.07075, 0.00470, 0.99538],
  'R-ForeTwist1': [-0.00317, 0.00342, -0.00024, 0.99999], 'L-Hand': [-0.04956, -0.08124, 0.09528, 0.99089],
  'R-Hand': [0.02527, 0.02704, -0.15387, 0.98740], 'L-Finger1': [-0.00330, -0.00415, -0.11695, 0.99312],
  'L-Finger2': [-0.00360, -0.00458, -0.12783, 0.99178], 'L-Thumb1': [0.17566, -0.23846, -0.01904, 0.95494],
  'R-Finger1': [-0.00330, 0.00415, 0.11695, 0.99312], 'R-Finger2': [-0.00360, 0.00458, 0.12783, 0.99178],
  'R-Thumb1': [0.14412, 0.25058, 0.06477, 0.95512], 'L-Finger11': [0.00562, 0.00690, 0.18134, 0.98338],
  'R-Finger11': [0.00562, -0.00690, -0.18134, 0.98338], 'L-Sleeve': [-0.06476, -0.07075, 0.00470, 0.99538],
  'R-Sleeve': [-0.00317, 0.00342, -0.00024, 0.99999],
}

/** The creator's standing pose as local rotations. `facingFront` drops the creator's 10.9 degree body turn. */
export function standingPose(facingFront = false): Record<string, THREE.Quaternion> {
  const out: Record<string, THREE.Quaternion> = {}
  for (const [name, [x, y, z, w]] of Object.entries(CREATOR_POSE)) {
    if (facingFront && name === 'Root') continue
    out[name] = new THREE.Quaternion(x, y, z, w).normalize()
  }
  return out
}

/** Per-bone skinning matrices for a pose (rotations about each joint, offsets added to the joint's offset from its parent). */
export function skinMatrices(rig: Rig, rotations: Record<string, THREE.Quaternion>, offsets: Record<string, [number, number, number]> = {}): THREE.Matrix4[] {
  const world: THREE.Matrix4[] = [], skin: THREE.Matrix4[] = []
  rig.bones.forEach((b, i) => {
    const t = b.rest.clone().sub(b.parent >= 0 ? rig.bones[b.parent].rest : new THREE.Vector3())
    const off = offsets[b.name]
    if (off) t.add(new THREE.Vector3(...off))
    const local = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)
    const q = rotations[b.name]
    if (q) local.multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(local) : local
    skin[i] = world[i].clone().multiply(new THREE.Matrix4().makeTranslation(-b.rest.x, -b.rest.y, -b.rest.z))
  })
  return skin
}

/** Linear blend skinning of positions in place (used to measure the posed character). */
export function skinPositions(pos: Float32Array, weights: Uint8Array, indices: Uint8Array, skin: THREE.Matrix4[]) {
  const e = skin.map((m) => m.elements), n = pos.length / 3
  for (let v = 0; v < n; v++) {
    let px = 0, py = 0, pz = 0, ws = 0
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2]
    for (let k = 0; k < 4; k++) {
      const w = weights[4 * v + k] / 255
      if (!w) continue
      const m = e[indices[4 * v + k]]
      if (!m) continue
      px += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); pz += w * (m[2] * x + m[6] * y + m[10] * z + m[14])
      ws += w
    }
    if (ws > 0) { pos[3 * v] = px / ws; pos[3 * v + 1] = py / ws; pos[3 * v + 2] = pz / ws }
  }
}
